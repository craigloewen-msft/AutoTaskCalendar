const { test, expect, withDb } = require('../fixtures');
const { UserDetails, TaskDetails, RoleDetails } = require('../../models');
const {
    parseDateOnly,
    parseInstant,
    localWeekBounds,
} = require('../../utils/temporal');
const { migrateTemporalData, legacyTaskDate } = require('../../utils/temporalMigration');
const moment = require('moment-timezone');


test.describe('temporal primitives and migration', () => {
    test('strictly separates civil dates from instants', () => {
        expect(parseDateOnly('2024-02-29').valid).toBe(true);
        expect(parseDateOnly('2024-02-31').valid).toBe(false);
        expect(parseDateOnly('2024-01-01T00:00:00Z').valid).toBe(false);
        expect(parseInstant('2024-01-01').valid).toBe(false);
        expect(parseInstant('2024-01-01T12:00:00').valid).toBe(false);
        expect(parseInstant('2024-01-01T00:00:00Z').valid).toBe(true);
    });

    test('builds local week bounds across DST', () => {
        const bounds = localWeekBounds('2024-03-10', 'America/New_York');
        expect(bounds.start.toISOString()).toBe('2024-03-10T05:00:00.000Z');
        expect(bounds.end.toISOString()).toBe('2024-03-17T04:00:00.000Z');
    });

    test('recovers the selected day from the old fixed-ms due timestamp', () => {
        const oldDue = new Date('2024-03-11T04:59:59.000Z');
        expect(legacyTaskDate(oldDue, 'America/New_York', { due: true })).toBe('2024-03-10');
    });

    test('migrates a legacy account through first login', async ({ seed, apiAnon }) => {
        const data = await seed();
        await withDb(() => UserDetails.updateOne(
            { _id: data.primary.user._id },
            {
                $unset: {
                    timeZone: 1,
                    workingStartMinutes: 1,
                    workingEndMinutes: 1,
                    temporalDataVersion: 1,
                },
                $set: {
                    workingStartTime: new Date('2024-01-15T14:30:00Z'),
                    workingDuration: 8,
                },
            }
        ));

        const response = await apiAnon.post('/api/login', {
            data: {
                username: 'testuser',
                password: 'testpassword',
                timeZone: 'America/New_York',
            },
        });
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.user.timeZone).toBe('America/New_York');
        expect(body.user.workingStartTime).toBe('09:30');
        expect(body.user.workingEndTime).toBe('17:30');
    });

    test('migrates legacy users idempotently without touching completion instants', async ({ seed }) => {
        const data = await seed();
        const completed = data.tasks.find((task) => task.completedDate);
        const completedInstant = completed.completedDate.getTime();
        const cutoffDate = moment().add(30, 'days').format('YYYY-MM-DD');
        const legacyCutoff = moment
            .tz(cutoffDate, 'YYYY-MM-DD', true, 'America/New_York')
            .toDate();

        await withDb(async () => {
            const completedOccurrence = await TaskDetails.create({
                title: 'Legacy completed occurrence',
                startDate: new Date('2024-03-10T05:00:00Z'),
                dueDate: new Date('2024-03-10T05:00:00Z'),
                occurrenceDate: new Date('2024-03-10T05:00:00Z'),
                completed: true,
                completedDate: new Date('2024-03-10T17:00:00Z'),
                seriesRef: data.named.weekdaysSeries._id,
                userRef: data.primary.user._id,
            });
            await RoleDetails.create({
                title: 'Legacy local date',
                startDate: new Date('2024-03-10T05:00:00Z'),
                userRef: data.primary.user._id,
            });
            await TaskDetails.updateOne(
                { _id: data.named.weekdaysSeries._id },
                { $set: { 'recurrence.endsOn': legacyCutoff } }
            );

            await UserDetails.updateOne(
                { _id: data.primary.user._id },
                {
                    $unset: {
                        timeZone: 1,
                        workingStartMinutes: 1,
                        workingEndMinutes: 1,
                        temporalDataVersion: 1,
                    },
                    $set: {
                        workingStartTime: new Date('2024-01-15T14:30:00Z'),
                        workingDuration: 8,
                    },
                }
            );
            const user = await UserDetails.findById(data.primary.user._id);
            await migrateTemporalData(user, 'America/New_York');
            await migrateTemporalData(user, 'America/New_York');

            const afterUser = await UserDetails.findById(user._id);
            expect(afterUser.timeZone).toBe('America/New_York');
            expect(afterUser.workingStartMinutes).toBe(570);
            expect(afterUser.workingEndMinutes).toBe(1050);
            expect(afterUser.workingStartTime).toBeUndefined();
            expect(afterUser.workingDuration).toBeUndefined();

            const afterTask = await TaskDetails.findById(completed._id);
            expect(afterTask.completedDate.getTime()).toBe(completedInstant);

            const occurrenceAfter = await TaskDetails.findById(completedOccurrence._id);
            expect(occurrenceAfter.completed).toBe(true);
            expect(occurrenceAfter.completedDate.toISOString()).toBe('2024-03-10T17:00:00.000Z');
            expect(occurrenceAfter.occurrenceDate.toISOString()).toBe('2024-03-10T00:00:00.000Z');

            const templateAfter = await TaskDetails.findById(data.named.weekdaysSeries._id);
            expect(templateAfter.recurrence.endsOn.toISOString().slice(0, 10)).toBe(cutoffDate);
            const roleAfter = await RoleDetails.findOne({ title: 'Legacy local date' });
            expect(roleAfter.startDate.toISOString()).toBe('2024-03-10T00:00:00.000Z');
            expect(await TaskDetails.countDocuments({
                seriesRef: data.named.weekdaysSeries._id,
                completed: { $ne: true },
            })).toBeGreaterThan(0);
        });
    });
});
