import express from 'express';
import path from 'path';
import cors from 'cors';
import apiRouter from './routes/api';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', apiRouter);

// Fallback to index.html for SPA-style navigation
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Conciliación App iniciada');
});

export default app;
