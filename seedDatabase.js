const mongoose = require('mongoose');
const fs = require('fs');
const moment = require('moment');

// Get config
const config = fs.existsSync('./config.js') ? require('./config') : require('./defaultconfig');

// Set up MongoDB connection
let mongooseConnectionString = '';

if (process.env.NODE_ENV == 'production') {
    mongooseConnectionString = process.env.prodMongoDBConnectionString;
} else {
    // Use localhost for direct docker runs, 'db' for docker-compose
    mongooseConnectionString = config.devMongoDBConnectionString.replace('mongodb://db/', 'mongodb://localhost/');
}

// Import schemas from app.js
const Schema = mongoose.Schema;

const UserDetail = new Schema({
    username: { type: String, index: true },
    password: String,
    email: String,
    lastLoginDate: Date,
    workingStartTime: Date,
    workingDuration: Number,
    workingDays: [String],
    googleAccessToken: String,
    googleRefreshToken: String,
    selectedCalendars: [String],
}, { collection: 'usercollection' });

UserDetail.virtual('taskList', {
    ref: 'taskInfo',
    localField: '_id',
    foreignField: 'userRef'
});

UserDetail.virtual('eventList', {
    ref: 'eventInfo',
    localField: '_id',
    foreignField: 'userRef'
});

const TaskDetail = new Schema({
    title: String,
    dueDate: Date,
    notes: String,
    duration: Number,
    startDate: Date,
    breakUpTask: Boolean,
    breakUpTaskChunkDuration: Number,
    completed: Boolean,
    scheduledDate: Date,
    repeat: String,
    isBacklog: Boolean,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
});

const EventDetail = new Schema({
    title: String,
    startDate: Date,
    endDate: Date,
    notes: String,
    type: String,
    externalEventID: String,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
    taskRef: { type: Schema.Types.ObjectId, ref: 'taskInfo' },
});

const passportLocalMongoose = require('passport-local-mongoose');
UserDetail.plugin(passportLocalMongoose);

const UserDetails = mongoose.model('userInfo', UserDetail, 'userInfo');
const TaskDetails = mongoose.model('taskInfo', TaskDetail, 'taskInfo');
const EventDetails = mongoose.model('eventInfo', EventDetail, 'eventInfo');

async function seedDatabase() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(mongooseConnectionString, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('Connected to MongoDB');

        // Check if test user already exists
        const existingUser = await UserDetails.findOne({ username: 'testuser' });
        
        if (existingUser) {
            console.log('Test user already exists. Deleting existing user and related data...');
            // Delete related tasks and events
            await TaskDetails.deleteMany({ userRef: existingUser._id });
            await EventDetails.deleteMany({ userRef: existingUser._id });
            await UserDetails.deleteOne({ username: 'testuser' });
            console.log('Existing test user data deleted');
        }

        // Create test user with known password
        console.log('Creating test user...');
        const nowDate = new Date();
        const startDate = new Date(nowDate.setHours(9, 0, 0, 0)); // 9 AM start time

        const testUser = await UserDetails.register({
            username: 'testuser',
            email: 'testuser@example.com',
            workingStartTime: startDate,
            workingDuration: 8, // 8 hour work day
            workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        }, 'testpassword');

        console.log(`Test user created with ID: ${testUser._id}`);

        // Create sample tasks
        console.log('Creating sample tasks...');
        
        const today = moment().startOf('day');
        const tomorrow = moment().add(1, 'days').startOf('day');
        const nextWeek = moment().add(7, 'days').startOf('day');

        const sampleTasks = [
            {
                title: 'Complete project proposal',
                notes: 'Write up the Q4 project proposal with budget estimates',
                dueDate: tomorrow.toDate(),
                startDate: today.toDate(),
                duration: 2,
                breakUpTask: false,
                completed: false,
                repeat: 'none',
                isBacklog: false,
                userRef: testUser._id
            },
            {
                title: 'Review team code',
                notes: 'Code review for the new feature branch',
                dueDate: tomorrow.add(2, 'days').toDate(),
                startDate: today.toDate(),
                duration: 1,
                breakUpTask: false,
                completed: false,
                repeat: 'none',
                isBacklog: false,
                userRef: testUser._id
            },
            {
                title: 'Update documentation',
                notes: 'Update API documentation for new endpoints',
                dueDate: nextWeek.toDate(),
                startDate: today.toDate(),
                duration: 3,
                breakUpTask: true,
                breakUpTaskChunkDuration: 1,
                completed: false,
                repeat: 'none',
                isBacklog: false,
                userRef: testUser._id
            },
            {
                title: 'Research new technologies',
                notes: 'Explore potential frameworks for the next project',
                dueDate: null,
                startDate: today.toDate(),
                duration: 2,
                breakUpTask: false,
                completed: false,
                repeat: 'none',
                isBacklog: true,
                userRef: testUser._id
            }
        ];

        const createdTasks = await TaskDetails.insertMany(sampleTasks);
        console.log(`Created ${createdTasks.length} sample tasks`);

        // Create sample events
        console.log('Creating sample events...');
        
        const sampleEvents = [
            {
                title: 'Team Meeting',
                startDate: moment().add(1, 'days').hour(10).minute(0).toDate(),
                endDate: moment().add(1, 'days').hour(11).minute(0).toDate(),
                notes: 'Weekly team sync',
                type: 'calendar',
                userRef: testUser._id
            },
            {
                title: 'Lunch Break',
                startDate: moment().add(1, 'days').hour(12).minute(0).toDate(),
                endDate: moment().add(1, 'days').hour(13).minute(0).toDate(),
                notes: 'Lunch',
                type: 'calendar',
                userRef: testUser._id
            },
            {
                title: 'Client Call',
                startDate: moment().add(2, 'days').hour(14).minute(0).toDate(),
                endDate: moment().add(2, 'days').hour(15).minute(0).toDate(),
                notes: 'Quarterly review with client',
                type: 'calendar',
                userRef: testUser._id
            }
        ];

        const createdEvents = await EventDetails.insertMany(sampleEvents);
        console.log(`Created ${createdEvents.length} sample events`);

        console.log('\n=================================================');
        console.log('Database seeded successfully!');
        console.log('=================================================');
        console.log('Test credentials:');
        console.log('  Username: testuser');
        console.log('  Password: testpassword');
        console.log('  Email: testuser@example.com');
        console.log('=================================================\n');

    } catch (error) {
        console.error('Error seeding database:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
        process.exit(0);
    }
}

// Run the seed function
seedDatabase();
