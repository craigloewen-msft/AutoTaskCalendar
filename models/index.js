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

// A recurrence rule. Lives on the series template; occurrences carry seriesRef instead.
// Shape mirrors iCalendar RRULE so a future .ics/Google mapping stays mechanical.
const RecurrenceRule = new Schema({
    freq: String,            // 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: { type: Number, default: 1 },  // every N periods
    byWeekday: [Number],     // 0=Sun..6=Sat, for weekly
    byMonthDay: [Number],    // 1..31, or -1 for the last day, for monthly
    endsOn: Date,            // null = never
    endsAfter: Number,       // occurrence count, null = never
}, { _id: false });

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
    recurrence: { type: RecurrenceRule, default: null },
    // Set on generated occurrences, pointing at the template that owns the rule.
    seriesRef: { type: Schema.Types.ObjectId, ref: 'taskInfo', default: null },
    // The local-midnight date this occurrence is for. Unique per series.
    occurrenceDate: { type: Date, default: null },
    // Templates hold the rule and are never scheduled or completed.
    isSeriesTemplate: { type: Boolean, default: false },
    isBacklog: Boolean,
    priority: { type: Number, default: 100 },
    dependsOn: [{ type: Schema.Types.ObjectId, ref: 'taskInfo' }],
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
    // Optional Compass link. A task with no project behaves exactly as before.
    projectRef: { type: Schema.Types.ObjectId, ref: 'projectInfo', default: null },
});

// --- Compass: roles > goals > projects. See docs/COMPASS.md. ---
// Children carry the parent ref; parents expose children through a virtual, so the whole
// tree is one populate() call. `virtuals: true` on toJSON is required or the populated
// children vanish when Express serialises the response.
const virtualsOn = { toJSON: { virtuals: true }, toObject: { virtuals: true } };

const RoleDetail = new Schema({
    title: String,
    description: String,
    startDate: Date,
    // No end date means the role is still active.
    endDate: Date,
    sortOrder: { type: Number, default: 0 },
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo', index: true },
}, virtualsOn);

RoleDetail.virtual('goalList', {
    ref: 'goalInfo',
    localField: '_id',
    foreignField: 'roleRef',
});

const GoalDetail = new Schema({
    title: String,
    description: String,
    startDate: Date,
    endDate: Date,
    sortOrder: { type: Number, default: 0 },
    roleRef: { type: Schema.Types.ObjectId, ref: 'roleInfo', index: true },
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo', index: true },
}, virtualsOn);

GoalDetail.virtual('projectList', {
    ref: 'projectInfo',
    localField: '_id',
    foreignField: 'goalRef',
});

const ProjectDetail = new Schema({
    title: String,
    description: String,
    // No start date means the project is parked as a "someday" item.
    startDate: Date,
    endDate: Date,
    sortOrder: { type: Number, default: 0 },
    goalRef: { type: Schema.Types.ObjectId, ref: 'goalInfo', index: true },
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo', index: true },
});

// Expansion upserts on this key, which is what keeps re-runs from duplicating occurrences.
TaskDetail.index({ seriesRef: 1, occurrenceDate: 1 });

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
const RoleDetails = mongoose.model('roleInfo', RoleDetail, 'roleInfo');
const GoalDetails = mongoose.model('goalInfo', GoalDetail, 'goalInfo');
const ProjectDetails = mongoose.model('projectInfo', ProjectDetail, 'projectInfo');

module.exports = {
    UserDetails,
    TaskDetails,
    EventDetails,
    RoleDetails,
    GoalDetails,
    ProjectDetails
};
