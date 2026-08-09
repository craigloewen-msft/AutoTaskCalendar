'use strict';

/**
 * The default local-development dataset: enough to see every feature work, small enough
 * to read at a glance.
 */
module.exports = {
    name: 'basic',
    description: 'A handful of tasks (one backlog, one broken up), 35 completed tasks, 3 events.',

    async build(b) {
        const primary = await b.createUser();
        const user = primary.user;

        const proposal = await b.createTask(user, {
            title: 'Complete project proposal',
            notes: 'Write up the Q4 project proposal with budget estimates',
            dueDate: b.endOfDay(b.anchor, 1),
            duration: 120,
            priority: 10,
        });

        const codeReview = await b.createTask(user, {
            title: 'Review team code',
            notes: 'Code review for the new feature branch',
            dueDate: b.endOfDay(b.anchor, 3),
            duration: 60,
        });

        const documentation = await b.createTask(user, {
            title: 'Update documentation',
            notes: 'Update API documentation for new endpoints',
            dueDate: b.endOfDay(b.anchor, 7),
            duration: 180,
            breakUpTask: true,
            breakUpTaskChunkDuration: 60,
        });

        const backlog = await b.createTask(user, {
            title: 'Research new technologies',
            notes: 'Explore potential frameworks for the next project',
            dueDate: null,
            duration: 120,
            isBacklog: true,
        });

        // Enough completed tasks to push the completed-tasks page past its 20-per-page limit.
        const completed = await b.createTasks(user, 35, (i) => ({
            title: `Completed Task ${i + 1}`,
            notes: `Sample notes for completed task number ${i + 1}`,
            dueDate: b.endOfDay(b.anchor, -(i + 1)),
            startDate: b.at(b.anchor, { days: -(i + 2) }),
            duration: 30 * ((i % 3) + 1),
            completed: true,
            completedDate: b.at(b.anchor, { days: -(i + 1), hours: 17 }),
            repeat: (i + 1) % 7 === 0 ? 'weekly' : null,
        }));

        const meeting = await b.createEvent(user, {
            title: 'Team Meeting',
            notes: 'Weekly team sync',
            startDate: b.at(b.anchor, { days: 1, hours: 10 }),
            endDate: b.at(b.anchor, { days: 1, hours: 11 }),
        });

        const lunch = await b.createEvent(user, {
            title: 'Lunch Break',
            notes: 'Lunch',
            startDate: b.at(b.anchor, { days: 1, hours: 12 }),
            endDate: b.at(b.anchor, { days: 1, hours: 13 }),
        });

        const clientCall = await b.createEvent(user, {
            title: 'Client Call',
            notes: 'Quarterly review with client',
            startDate: b.at(b.anchor, { days: 2, hours: 14 }),
            endDate: b.at(b.anchor, { days: 2, hours: 15 }),
        });

        return {
            primary,
            named: { proposal, codeReview, documentation, backlog, meeting, lunch, clientCall },
            completedCount: completed.length,
        };
    },
};
