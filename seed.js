import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Project from './models/Project.js';

dotenv.config();

const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL)
  .then(async () => {
    console.log('Connected to MongoDB. Seeding projects...');

    // Clear existing configurations
    await Project.deleteMany({});

    // Seed projects
    const projects = [
      {
        projectId: "nextjs-project",
        name: "Next.js Admin Panel",
        tokenLimit: 1000000, // 1,000,000 tokens
        tokensUsed: 0,
        isActive: true
      },
      {
        projectId: "react-node-project",
        name: "React Node Chatbot App",
        tokenLimit: 500000,  // 500,000 tokens
        tokensUsed: 0,
        isActive: true
      }
    ];

    await Project.insertMany(projects);
    console.log('Successfully seeded projects:');
    console.log(projects);

    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
