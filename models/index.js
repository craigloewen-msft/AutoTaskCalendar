const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

const Schema = mongoose.Schema;
const { dateOnlyFromMarker } = require('../utils/temporal');

function serializeCivilDate(ret, path) {
    if (ret[path]) ret[path] = dateOnlyFromMarker(ret[path]);
}

function taskTemporalTransform(doc, ret) {
    serializeCivilDate(ret, 'startDate');
    serializeCivilDate(ret, 'dueDate');
    serializeCivilDate(ret, 'occurrenceDate');
    if (ret.recurrence?.endsOn) ret.recurrence.endsOn = dateOnlyFromMarker(ret.recurrence.endsOn);
    return ret;
}

function compassTemporalTransform(doc, ret) {
    serializeCivilDate(ret, 'startDate');
    serializeCivilDate(ret, 'endDate');
    return ret;
}

const UserDetail = new Schema({
    username: { type: String, index: true },
    password: String,
    email: String,
    lastLoginDate: Date,
    // Deprecated compatibility fields. Migrated users use timezone-aware wall-clock values.
    workingStartTime: Date,
    workingDuration: Number,
    timeZone: { type: String, default: 'UTC' },
    workingStartMinutes: { type: Number, default: 540 },
    workingEndMinutes: { type: Number, default: 1020 },
    temporalDataVersion: { type: Number, default: 0 },
    workingDays: [String],
    googleAccessTokenEncrypted: String,
    googleRefreshTokenEncrypted: String,
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

// A recurrence rule. A task holding one is a series template: it is never scheduled
// itself, and the scheduler materialises occurrences from it.
const RecurrenceRule = new Schema({
    freq: String,            // 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: { type: Number, default: 1 },  // every N periods
    byWeekday: [Number],     // 0=Sun..6=Sat, for weekly
    byMonthDay: [Number],    // 1..31, or -1 for the last day, for monthly
    endsOn: Date,            // null = never
    endsAfter: Number,       // occurrence count, null = never
    whenUnschedulableBehavior: {
        type: String,
        enum: ['skip', 'next-available'],
        default: 'skip',
    },
}, { _id: false });

const SlipForecastImpact = new Schema({
    taskId: { type: Schema.Types.ObjectId, ref: 'taskInfo' },
    title: String,
    baselineStart: Date,
    baselineEnd: Date,
    forecastStart: Date,
    forecastEnd: Date,
    baselineDate: String,
    forecastDate: String,
    dueDate: String,
    moved: Boolean,
    newlyLate: Boolean,
    unscheduled: Boolean,
}, { _id: false });

const TaskSlipForecast = new Schema({
    movedCount: Number,
    newlyLateCount: Number,
    affected: [SlipForecastImpact],
    calculatedAt: Date,
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
    // Scheduler OUTPUT: where the algorithm actually placed this task. Recomputed from
    // scratch on every scheduling run, and null until the first one.
    scheduledDate: Date,
    // Scheduler output for the same generated schedule; null when inputs change.
    slipForecast: { type: TaskSlipForecast, default: null },
    repeat: String,
    recurrence: { type: RecurrenceRule, default: null },
    // Set on generated occurrences, pointing at the template that owns the rule.
    seriesRef: { type: Schema.Types.ObjectId, ref: 'taskInfo', default: null },
    // Scheduler INPUT: canonical UTC marker for the civil date this occurrence represents.
    // Stable identity, unlike scheduledDate, which slips when a day is already full.
    occurrenceDate: { type: Date, default: null },
    isBacklog: Boolean,
    priority: { type: Number, default: 100 },
    dependsOn: [{ type: Schema.Types.ObjectId, ref: 'taskInfo' }],
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
    // Optional Compass link. A task with no project behaves exactly as before.
    projectRef: { type: Schema.Types.ObjectId, ref: 'projectInfo', default: null },
}, { toJSON: { transform: taskTemporalTransform }, toObject: { transform: taskTemporalTransform } });

// --- Compass: roles > goals > projects. See docs/COMPASS.md. ---
// Children carry the parent ref; parents expose children through a virtual, so the whole
// tree is one populate() call. `virtuals: true` on toJSON is required or the populated
// children vanish when Express serialises the response.
const virtualsOn = {
    toJSON: { virtuals: true, transform: compassTemporalTransform },
    toObject: { virtuals: true, transform: compassTemporalTransform },
};

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
}, { toJSON: { transform: compassTemporalTransform }, toObject: { transform: compassTemporalTransform } });

// Expansion dedupes on this key, so re-runs never duplicate occurrences.
TaskDetail.index({ seriesRef: 1, occurrenceDate: 1 });
TaskDetail.index({ userRef: 1, completed: 1, completedDate: -1, projectRef: 1 });

// Add a new schema for events
const EventDetail = new Schema({
    title: String,
    startDate: Date,
    endDate: Date,
    notes: String,
    type: String,
    externalEventID: String,
    allDay: { type: Boolean, default: false },
    allDayStart: { type: String, default: null },
    allDayEnd: { type: String, default: null },
    sourceTimeZone: { type: String, default: null },
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
    taskRef: { type: Schema.Types.ObjectId, ref: 'taskInfo' },
});

const GoogleOAuthStateDetail = new Schema({
    stateDigest: { type: String, required: true, unique: true },
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo', required: true, index: true },
    sessionDigest: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
}, { collection: 'googleOAuthState' });

GoogleOAuthStateDetail.index({ userRef: 1, sessionDigest: 1 }, { unique: true });

UserDetail.plugin(passportLocalMongoose);

const UserDetails = mongoose.model('userInfo', UserDetail, 'userInfo');
const TaskDetails = mongoose.model('taskInfo', TaskDetail, 'taskInfo');
const EventDetails = mongoose.model('eventInfo', EventDetail, 'eventInfo');
const RoleDetails = mongoose.model('roleInfo', RoleDetail, 'roleInfo');
const GoalDetails = mongoose.model('goalInfo', GoalDetail, 'goalInfo');
const ProjectDetails = mongoose.model('projectInfo', ProjectDetail, 'projectInfo');
const GoogleOAuthStateDetails = mongoose.model(
    'googleOAuthState',
    GoogleOAuthStateDetail,
    'googleOAuthState'
);

module.exports = {
    UserDetails,
    TaskDetails,
    EventDetails,
    RoleDetails,
    GoalDetails,
    ProjectDetails,
    GoogleOAuthStateDetails
};
