import app from './app.js';
app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`LabTrack: http://localhost:${process.env.PORT || 3000}`));
