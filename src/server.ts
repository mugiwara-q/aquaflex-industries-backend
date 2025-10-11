import express from 'express';
import multer from 'multer';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/", (req, res) => res.send("Backend running ! " + new Date().toLocaleString()))

// Telegram Bot setup
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error('Telegram bot token or chat ID is missing. Please check your .env file.');
  process.exit(1);
}

const bot = new TelegramBot(token);

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Routes
app.post('/api/3d-quote', upload.array('files'), async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const files = req.files as Express.Multer.File[];
    const jobsData = JSON.parse(req.body.jobs);

    let caption = `
      *Nouvelle demande de devis impression 3D*

      *Contact*
      👤 Nom: ${firstName} ${lastName}
      📧 Email: ${email}

      *Fichiers*
      ${jobsData.map((job: any, index: number) => `
        ${index + 1}. ${job.filename}
        - Matériau: ${job.material}
        - Quantité: ${job.quantity}
        - Hauteur de couche: ${job.layerHeight}
        - Remplissage: ${job.infill}
        - Couleur: ${job.color}
        - Volume estimé: ${job.volume.toFixed(2)} cm³
        ${job.urgency === 'urgent' ? '⚠️ URGENT' : ''}
      `).join('\n')}

      *Prix total indicatif: ${jobsData.reduce((acc: number, job: any) => acc + job.price, 0).toFixed(2)}€*

      ${req.body.notes ? `*Notes:*\n${req.body.notes}` : ''}
    `;

    await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });

    // Send each 3D file
    for (const file of files) {
      await bot.sendDocument(chatId, file.path, {}, {
        filename: file.originalname,
        contentType: file.mimetype,
      });
      // Clean up the uploaded file
      fs.unlinkSync(file.path);
    }

    res.status(200).json({ success: true, message: '3D quote request sent successfully.' });
  } catch (error) {
    console.error('Error sending 3D quote request to Telegram:', error);
    res.status(500).json({ success: false, message: 'Failed to send 3D quote request.' });
  }
});

app.post('/api/quote', upload.single('file'), async (req, res) => {
  try {
    const { name, company, email, phone, message } = req.body;
    const file = req.file;

    let caption = `
      *Nouvelle demande de devis*

      *Nom:* ${name}
      *Entreprise:* ${company || 'N/A'}
      *Email:* ${email}
      *Téléphone:* ${phone || 'N/A'}

      *Message:*
      ${message}
    `;

    await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });

    if (file) {
      await bot.sendDocument(chatId, file.path, {}, {
        filename: file.originalname,
        contentType: file.mimetype,
      });
      // Clean up the uploaded file
      fs.unlinkSync(file.path);
    }

    res.status(200).json({ success: true, message: 'Quote request sent successfully.' });
  } catch (error) {
    console.error('Error sending quote request to Telegram:', error);
    res.status(500).json({ success: false, message: 'Failed to send quote request.' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
