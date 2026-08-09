'use strict';

/**
 * A realistic power user, plus a second user whose data must never leak into the first
 * user's responses. This is the scenario most regression tests should use.
 */
module.exports = {
    name: 'full',
    description:
        'Power user: ~40 active tasks with priorities/dependencies/repeats, 70 completed ' +
        'tasks over 90 days, a week of calendar events, plus a second isolated user.',

    async build(b) {
        const primary = await b.createUser();
        const user = primary.user;

        // --- Active tasks spanning priorities and due dates ------------------------------
        const active = await b.createTasks(user, 24, (i) => ({
            title: `Active task ${i + 1}`,
            dueDate: b.endOfDay(b.anchor, (i % 10) + 1),
            startDate: b.at(b.anchor, { days: -1 }),
            duration: 30 * ((i % 4) + 1),
            priority: [10, 50, 100, 200][i % 4],
        }));

        // --- Broken-up tasks -------------------------------------------------------------
        const chunked = await b.createTasks(user, 3, (i) => ({
            title: `Chunked task ${i + 1}`,
            dueDate: b.endOfDay(b.anchor, 5 + i),
            duration: 240,
            breakUpTask: true,
            breakUpTaskChunkDuration: 60,
        }));

        // --- Dependency chain: research -> draft -> publish -------------------------------
        const research = await b.createTask(user, {
            title: 'Research the migration',
            dueDate: b.endOfDay(b.anchor, 3),
            duration: 90,
            priority: 20,
        });
        const draft = await b.createTask(user, {
            title: 'Draft the migration plan',
            dueDate: b.endOfDay(b.anchor, 4),
            duration: 60,
            priority: 20,
            dependsOn: [research._id],
        });
        const publish = await b.createTask(user, {
            title: 'Publish the migration plan',
            dueDate: b.endOfDay(b.anchor, 5),
            duration: 30,
            priority: 20,
            dependsOn: [draft._id],
        });

        // --- Repeating tasks --------------------------------------------------------------
        const repeating = [];
        for (const repeat of ['daily', 'weekly', 'monthly']) {
            repeating.push(
                await b.createTask(user, {
                    title: `Recurring ${repeat} check-in`,
                    dueDate: b.endOfDay(b.anchor, 2),
                    duration: 30,
                    repeat,
                })
            );
        }

        // --- Backlog ----------------------------------------------------------------------
        const backlog = await b.createTasks(user, 6, (i) => ({
            title: `Backlog idea ${i + 1}`,
            dueDate: null,
            duration: 60 * ((i % 3) + 1),
            isBacklog: true,
        }));

        // --- History: 70 completed tasks over 90 days, for pagination/search/statistics ----
        const completed = await b.createTasks(user, 70, (i) => ({
            // A distinctive word in a subset gives search tests something exact to match.
            title: i % 10 === 0 ? `Archived quarterly report ${i}` : `Finished task ${i + 1}`,
            notes: i % 10 === 0 ? 'Quarterly reporting cycle' : 'Routine work',
            dueDate: b.endOfDay(b.anchor, -Math.floor((i * 90) / 70) - 1),
            startDate: b.at(b.anchor, { days: -Math.floor((i * 90) / 70) - 2 }),
            duration: 15 * ((i % 8) + 1),
            completed: true,
            completedDate: b.at(b.anchor, {
                days: -Math.floor((i * 90) / 70) - 1,
                hours: 9 + (i % 8),
            }),
            repeat: i % 12 === 0 ? 'weekly' : null,
        }));

        // --- A working week of calendar events, including an overlap ----------------------
        const events = [];
        for (let day = 0; day < 7; day++) {
            events.push(
                await b.createEvent(user, {
                    title: `Standup day ${day + 1}`,
                    startDate: b.at(b.anchor, { days: day, hours: 9, minutes: 30 }),
                    endDate: b.at(b.anchor, { days: day, hours: 10 }),
                })
            );
            events.push(
                await b.createEvent(user, {
                    title: `Lunch day ${day + 1}`,
                    startDate: b.at(b.anchor, { days: day, hours: 12 }),
                    endDate: b.at(b.anchor, { days: day, hours: 13 }),
                })
            );
        }

        // Two events that deliberately overlap each other.
        events.push(
            await b.createEvent(user, {
                title: 'Overlapping design review',
                startDate: b.at(b.anchor, { days: 2, hours: 14 }),
                endDate: b.at(b.anchor, { days: 2, hours: 16 }),
            })
        );
        events.push(
            await b.createEvent(user, {
                title: 'Overlapping vendor call',
                startDate: b.at(b.anchor, { days: 2, hours: 15 }),
                endDate: b.at(b.anchor, { days: 2, hours: 17 }),
            })
        );

        // A day-long block, the closest this schema gets to an all-day event.
        events.push(
            await b.createEvent(user, {
                title: 'Company offsite',
                startDate: b.at(b.anchor, { days: 4 }),
                endDate: b.at(b.anchor, { days: 5 }),
            })
        );

        // --- Second user: data that must never appear in the primary user's responses -----
        const other = await b.createUser({
            username: 'otheruser',
            email: 'otheruser@example.com',
        });
        await b.createTasks(other.user, 5, (i) => ({
            title: `OTHER USER SECRET TASK ${i + 1}`,
            dueDate: b.endOfDay(b.anchor, i + 1),
        }));
        await b.createEvent(other.user, { title: 'OTHER USER SECRET EVENT' });

        return {
            primary,
            other,
            named: { research, draft, publish },
            counts: {
                active: active.length,
                chunked: chunked.length,
                repeating: repeating.length,
                backlog: backlog.length,
                completed: completed.length,
                events: events.length,
            },
        };
    },
};
