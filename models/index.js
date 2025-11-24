const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

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
    completedDate: Date,
    scheduledDate: Date,
    repeat: String,
    isBacklog: Boolean,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
});

// Add a new schema for events
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

UserDetail.plugin(passportLocalMongoose);

const UserDetails = mongoose.model('userInfo', UserDetail, 'userInfo');
const TaskDetails = mongoose.model('taskInfo', TaskDetail, 'taskInfo');
const EventDetails = mongoose.model('eventInfo', EventDetail, 'eventInfo');

module.exports = {
    UserDetails,
    TaskDetails,
    EventDetails
};
