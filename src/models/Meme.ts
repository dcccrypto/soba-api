import mongoose from 'mongoose';

const memeSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  pathname: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    required: true,
  },
  uploadDate: {
    type: Date,
    default: Date.now,
  },
});

export const Meme = mongoose.model('Meme', memeSchema);
