import { transaction } from './db.js';

export const modules = {
  students: { title: 'Students', singular: 'Student', pk: 'student_id', fields: { student_no: 'Student number', full_name: 'Full name', course: 'Course', email: 'Email address' } },
  categories: { title: 'Categories', singular: 'Category', pk: 'category_id', fields: { category_name: 'Category name', description: 'Description' } },
  equipment: { title: 'Equipment', singular: 'Equipment', pk: 'equipment_id', fields: { equipment_code: 'Equipment code', equipment_name: 'Equipment name', category_id: 'Category', total_quantity: 'Total quantity', available_quantity: 'Available quantity', condition_status: 'Condition' } }
};
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function positive(value, name) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) throw new Error(`${name} must be a positive whole number.`);
  return Number(value);
}
export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Enter a valid date.');
  return value;
}
export function friendly(error) {
  if (error.code === '23001') return 'This record is linked to other records and cannot be deleted.';
  return ({ '23505': 'That code, student number, email, or category name already exists.', '23503': 'This record is linked to other records, or a selected record no longer exists.', '23514': 'The values do not satisfy the inventory rules.', '22001': 'One of the values is too long.' })[error.code] || (error.code ? 'The database operation failed. Please try again.' : error.message);
}
const lengths = { student_no: 20, full_name: 100, course: 50, email: 100, category_name: 60, description: 255, equipment_code: 20, equipment_name: 100 };
export async function saveRecord(db, module, input, id = null) {
  const config = modules[module];
  if (!config) throw new Error('Unknown module.');
  if (id !== null) id = positive(id, 'Record ID');
  const data = {};
  for (const [key, label] of Object.entries(config.fields)) {
    const value = typeof input[key] === 'string' ? input[key].trim() : String(input[key] ?? '').trim();
    if (key !== 'description' && !value) throw new Error(`${label} is required.`);
    if (lengths[key] && [...value].length > lengths[key]) throw new Error(`${label} must be at most ${lengths[key]} characters.`);
    data[key] = value;
  }
  if (module === 'students' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Enter a valid email address.');
  return transaction(db, async client => {
    if (id) {
      const found = await client.query(`SELECT ${config.pk} FROM labtrack.${module} WHERE ${config.pk}=$1 FOR UPDATE`, [id]);
      if (!found.rowCount) throw new Error('This record does not exist.');
    }
    if (module === 'equipment') {
      data.total_quantity = positive(data.total_quantity, 'Total quantity');
      if (!/^\d+$/.test(data.available_quantity) || !Number.isSafeInteger(Number(data.available_quantity))) throw new Error('Available quantity must be a nonnegative whole number.');
      data.available_quantity = Number(data.available_quantity);
      const loan = id ? Number((await client.query('SELECT COALESCE(SUM(quantity),0) n FROM labtrack.borrowings WHERE equipment_id=$1 AND return_date IS NULL', [id])).rows[0].n) : 0;
      if (data.total_quantity < loan || data.available_quantity > data.total_quantity - loan) throw new Error(`Available and total quantities must account for the ${loan} units currently on loan.`);
      data.category_id = positive(data.category_id, 'Category');
      if (!['Good', 'For Repair'].includes(data.condition_status)) throw new Error('Choose a valid condition.');
    }
    const keys = Object.keys(data), values = Object.values(data);
    const result = id
      ? await client.query(`UPDATE labtrack.${module} SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(',')} WHERE ${config.pk}=$${values.length + 1} RETURNING *`, [...values, id])
      : await client.query(`INSERT INTO labtrack.${module} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, values);
    return result.rows[0];
  });
}
export async function deleteRecord(db, module, id) {
  const config = modules[module];
  if (!config) throw new Error('Unknown module.');
  const result = await db.query(`DELETE FROM labtrack.${module} WHERE ${config.pk}=$1 RETURNING ${config.pk}`, [positive(id, 'Record ID')]);
  if (!result.rowCount) throw new Error('This record does not exist.');
}
export async function borrowEquipment(db, input) {
  const student = positive(input.student_id, 'Student'), equipment = positive(input.equipment_id, 'Equipment'), quantity = positive(input.quantity, 'Quantity');
  const borrow = dateValue(input.borrow_date), due = dateValue(input.due_date);
  if (due < borrow) throw new Error('Due date cannot be earlier than the borrow date.');
  if (borrow > today()) throw new Error('Borrow date cannot be in the future.');
  return transaction(db, async client => {
    const item = (await client.query('SELECT * FROM labtrack.equipment WHERE equipment_id=$1 FOR UPDATE', [equipment])).rows[0];
    if (!item) throw new Error('Equipment not found.');
    if (item.condition_status === 'For Repair') throw new Error('This equipment is marked For Repair and cannot be borrowed.');
    if (quantity > item.available_quantity) throw new Error(`Not enough available stock. Only ${item.available_quantity} units are available.`);
    const result = await client.query('INSERT INTO labtrack.borrowings (student_id,equipment_id,quantity,borrow_date,due_date,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING borrowing_id', [student, equipment, quantity, borrow, due, due < today() ? 'Overdue' : 'Borrowed']);
    await client.query('UPDATE labtrack.equipment SET available_quantity=available_quantity-$1 WHERE equipment_id=$2', [quantity, equipment]);
    return result.rows[0].borrowing_id;
  });
}
export async function returnEquipment(db, id, value) {
  id = positive(id, 'Borrowing ID');
  const date = dateValue(value);
  return transaction(db, async client => {
    const record = (await client.query('SELECT *,borrow_date::text,return_date::text FROM labtrack.borrowings WHERE borrowing_id=$1 FOR UPDATE', [id])).rows[0];
    if (!record) throw new Error('Borrowing record not found.');
    if (record.return_date !== null) throw new Error('This equipment has already been returned. Stock was not changed.');
    if (date < record.borrow_date || date > today()) throw new Error('Return date must be between the borrow date and today.');
    const item = (await client.query('SELECT * FROM labtrack.equipment WHERE equipment_id=$1 FOR UPDATE', [record.equipment_id])).rows[0];
    if (item.available_quantity + record.quantity > item.total_quantity) throw new Error('Stock would exceed total quantity.');
    await client.query("UPDATE labtrack.borrowings SET return_date=$1,status='Returned' WHERE borrowing_id=$2", [date, id]);
    await client.query('UPDATE labtrack.equipment SET available_quantity=available_quantity+$1 WHERE equipment_id=$2', [record.quantity, record.equipment_id]);
  });
}
export async function history(db, filters = {}, limit = null) {
  const where = [], values = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  const status = "CASE WHEN b.return_date IS NOT NULL THEN 'Returned' WHEN b.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN 'Overdue' ELSE 'Borrowed' END";
  if (typeof filters.q === 'string' && filters.q.trim()) add("concat_ws(' ',s.student_no,s.full_name,e.equipment_name,e.equipment_code) ILIKE ?", `%${filters.q.trim()}%`);
  if (['Borrowed', 'Overdue', 'Returned'].includes(filters.status)) add(`${status} = ?`, filters.status);
  if (filters.from) add('b.borrow_date >= ?', dateValue(filters.from));
  if (filters.to) add('b.borrow_date <= ?', dateValue(filters.to));
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('Start date must be on or before end date.');
  return (await db.query(`SELECT b.*,b.borrow_date::text,b.due_date::text,b.return_date::text,s.full_name,s.student_no,e.equipment_name,e.equipment_code,c.category_name,${status} AS display_status FROM labtrack.borrowings b JOIN labtrack.students s USING(student_id) JOIN labtrack.equipment e USING(equipment_id) JOIN labtrack.categories c USING(category_id) ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.borrowing_id DESC ${limit ? 'LIMIT ' + positive(limit, 'Limit') : ''}`, values)).rows;
}
