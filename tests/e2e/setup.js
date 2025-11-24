const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Seeds the database with test data
 * This creates a test user and sample tasks/events
 */
async function seedDatabase() {
  console.log('Seeding database...');
  try {
    const { stdout, stderr } = await execPromise('npm run seed', {
      cwd: process.cwd(),
      timeout: 30000,
    });
    console.log('Database seeded successfully');
    if (stderr && !stderr.includes('DeprecationWarning')) {
      console.log('Seed stderr:', stderr);
    }
    return true;
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

/**
 * Wait for MongoDB to be ready
 */
async function waitForMongoDB(maxRetries = 10, delayMs = 2000) {
  const mongoose = require('mongoose');
  const fs = require('fs');
  const config = fs.existsSync('./config.js') ? require('../../config') : require('../../defaultconfig');
  
  let mongooseConnectionString = config.devMongoDBConnectionString.replace('mongodb://db/', 'mongodb://localhost/');
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await mongoose.connect(mongooseConnectionString, { 
        useNewUrlParser: true, 
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
      });
      console.log('MongoDB is ready');
      await mongoose.connection.close();
      return true;
    } catch (error) {
      console.log(`Waiting for MongoDB (attempt ${i + 1}/${maxRetries})...`);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error('MongoDB did not become ready in time');
}

module.exports = {
  seedDatabase,
  waitForMongoDB,
};
