'use strict';

/**
 * Deliberately hostile data. Nothing here should crash the API or hang the scheduler.
 * When a bug is found in the wild, add its shape to this scenario.
 */
module.exports = {
    name: 'edge',
    description: 'Hostile inputs: odd durations, past/absent due dates, unicode, blocked deps.',

    async build(b) {
        const primary = await b.createUser();
        const user = primary.user;

        const zeroDuration = await b.createTask(user, {
            title: 'Zero duration task',
            duration: 0,
            dueDate: b.endOfDay(b.anchor, 1),
        });

        // Longer than the 8 hour working day and not breakable, so it can never fit.
        const longerThanWorkday = await b.createTask(user, {
            title: 'Task longer than the working day',
            duration: 10 * 60,
            dueDate: b.endOfDay(b.anchor, 2),
        });

        const overdue = await b.createTask(user, {
            title: 'Overdue since last month',
            duration: 45,
            dueDate: b.endOfDay(b.anchor, -30),
            startDate: b.at(b.anchor, { days: -60 }),
        });

        const noDueDate = await b.createTask(user, {
            title: 'No due date at all',
            duration: 45,
            dueDate: null,
            isBacklog: true,
        });

        const unicode = await b.createTask(user, {
            title: '🚀 Ünïcödé täsk — 日本語 — <script>alert(1)</script>',
            notes: 'Emoji 🎉, accents éàü, CJK 漢字, and HTML-looking text.',
            duration: 30,
            dueDate: b.endOfDay(b.anchor, 1),
        });

        const longTitle = await b.createTask(user, {
            title: 'L' + 'o'.repeat(480) + 'ng title',
            duration: 30,
            dueDate: b.endOfDay(b.anchor, 1),
        });

        // Dependency that is itself unschedulable, so the dependent must not deadlock.
        const blocker = await b.createTask(user, {
            title: 'Blocker that cannot fit',
            duration: 12 * 60,
            dueDate: b.endOfDay(b.anchor, 1),
        });
        const blocked = await b.createTask(user, {
            title: 'Blocked by the unschedulable blocker',
            duration: 30,
            dueDate: b.endOfDay(b.anchor, 2),
            dependsOn: [blocker._id],
        });

        // A task that starts in the future: the scheduler must not place it before then.
        const future = await b.createTask(user, {
            title: 'Starts next week',
            duration: 60,
            startDate: b.at(b.anchor, { days: 7 }),
            dueDate: b.endOfDay(b.anchor, 10),
        });

        // Events sitting exactly on the working-hours boundaries (09:00 and 17:00).
        const boundaryStart = await b.createEvent(user, {
            title: 'Starts exactly at the start of work',
            startDate: b.at(b.anchor, { days: 1, hours: 9 }),
            endDate: b.at(b.anchor, { days: 1, hours: 10 }),
        });
        const boundaryEnd = await b.createEvent(user, {
            title: 'Ends exactly at the end of work',
            startDate: b.at(b.anchor, { days: 1, hours: 16 }),
            endDate: b.at(b.anchor, { days: 1, hours: 17 }),
        });

        // A week-long event covering a DST transition if one falls in range.
        const dstSpan = await b.createEvent(user, {
            title: 'Spans a possible DST change',
            startDate: b.at(b.anchor, { days: 1 }),
            endDate: b.at(b.anchor, { days: 8 }),
        });

        return {
            primary,
            named: {
                zeroDuration,
                longerThanWorkday,
                overdue,
                noDueDate,
                unicode,
                longTitle,
                blocker,
                blocked,
                future,
                boundaryStart,
                boundaryEnd,
                dstSpan,
            },
        };
    },
};
