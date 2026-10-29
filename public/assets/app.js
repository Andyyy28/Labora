const choice = document.querySelector('#equipment-choice');
if (choice) { const update = () => { const option = choice.selectedOptions[0]; document.querySelector('#stock-hint').textContent = option.value ? `${option.dataset.stock} units available · ${option.dataset.condition}` : 'Select equipment to see its availability.'; }; choice.addEventListener('change', update); update(); }
