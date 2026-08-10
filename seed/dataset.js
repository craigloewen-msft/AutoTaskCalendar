'use strict';

/**
 * The dataset. One user, and everything worth testing in a single seed.
 *
 * Rich enough for pagination and scheduling, hostile enough to catch crashes. When you
 * find a bug in the wild, add its shape to this file so it is covered forever after.
 *
 * A second user exists solely to prove their data never leaks into the first user's views.
 */

module.exports = {
    name: 'dataset',

    async build(b) {
        const primary = await b.createUser();
        const user = primary.user;

        // --- Readable, hand-written tasks -------------------------------------------------
        // Named so tests and humans can refer to them without guessing.
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

        // Broken into chunks, so chunk scheduling and completion are always covered.
        const documentation = await b.createTask(user, {
            title: 'Update documentation',
            notes: 'Update API documentation for new endpoints',
            dueDate: b.endOfDay(b.anchor, 7),
            duration: 180,
            breakUpTask: true,
            breakUpTaskChunkDuration: 60,
        });

        const backlogIdea = await b.createTask(user, {
            title: 'Research new technologies',
            notes: 'Explore potential frameworks for the next project',
            dueDate: null,
            duration: 120,
            isBacklog: true,
        });

        // --- Bulk active tasks across priorities and due dates ----------------------------
        const active = await b.createTasks(user, 20, (i) => ({
            title: `Active task ${i + 1}`,
            dueDate: b.endOfDay(b.anchor, (i % 10) + 1),
            startDate: b.at(b.anchor, { days: -1 }),
            duration: 30 * ((i % 4) + 1),
            priority: [10, 50, 100, 200][i % 4],
        }));

        const backlog = await b.createTasks(user, 5, (i) => ({
            title: `Backlog idea ${i + 1}`,
            dueDate: null,
            duration: 60 * ((i % 3) + 1),
            isBacklog: true,
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

        // --- Edge cases: nothing here should crash the API or hang the scheduler ----------
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

        // A dependency that cannot itself be scheduled, so the dependent must not deadlock.
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

        // Starts in the future: must not be scheduled before then.
        const future = await b.createTask(user, {
            title: 'Starts next week',
            duration: 60,
            startDate: b.at(b.anchor, { days: 7 }),
            dueDate: b.endOfDay(b.anchor, 10),
        });

        // --- History: 70 completed tasks over 90 days -------------------------------------
        // Enough to page through (20 per page) and to give search something to find.
        const completed = await b.createTasks(user, 70, (i) => ({
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

        // --- Calendar events --------------------------------------------------------------
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
        events.push(boundaryStart, boundaryEnd);

        // A day-long block, the closest this schema gets to an all-day event.
        events.push(
            await b.createEvent(user, {
                title: 'Company offsite',
                startDate: b.at(b.anchor, { days: 4 }),
                endDate: b.at(b.anchor, { days: 5 }),
            })
        );

        // Two named events, so tests can update and delete a known one.
        const meeting = await b.createEvent(user, {
            title: 'Team Meeting',
            notes: 'Weekly team sync',
            startDate: b.at(b.anchor, { days: 1, hours: 10 }),
            endDate: b.at(b.anchor, { days: 1, hours: 11 }),
        });
        const clientCall = await b.createEvent(user, {
            title: 'Client Call',
            notes: 'Quarterly review with client',
            startDate: b.at(b.anchor, { days: 2, hours: 10 }),
            endDate: b.at(b.anchor, { days: 2, hours: 11 }),
        });
        events.push(meeting, clientCall);

        // --- Compass: roles > goals > projects --------------------------------------------
        // 3 active roles plus 1 ended one. End dates are spread across quarters so the
        // completedFrom/completedTo query has something to slice.
        const engineerRole = await b.createRole(user, {
            title: 'Engineer',
            description: 'Build and ship good software',
            color: '#667eea',
            startDate: b.at(b.anchor, { days: -400 }),
            sortOrder: 0,
        });
        const fatherRole = await b.createRole(user, {
            title: 'Father',
            description: 'Be present for my family',
            color: '#10b981',
            startDate: b.at(b.anchor, { days: -900 }),
            sortOrder: 1,
        });
        const healthRole = await b.createRole(user, {
            title: 'Health',
            description: 'Stay strong enough to enjoy the rest',
            color: '#f59e0b',
            startDate: b.at(b.anchor, { days: -200 }),
            sortOrder: 2,
        });
        const endedRole = await b.createRole(user, {
            title: 'Volunteer board member',
            description: 'A role I have since stepped away from',
            color: '#94a3b8',
            startDate: b.at(b.anchor, { days: -700 }),
            endDate: b.at(b.anchor, { days: -120 }),
            sortOrder: 3,
        });

        // Two goals per role, one of them ended, so archive and active both have content.
        const shipV2 = await b.createGoal(user, engineerRole, {
            title: 'Ship v2 by June',
            description: 'The rewrite lands and customers are migrated',
            startDate: b.at(b.anchor, { days: -150 }),
            sortOrder: 0,
        });
        const growTeam = await b.createGoal(user, engineerRole, {
            title: 'Grow the team',
            description: 'Hire two engineers and get them productive',
            startDate: b.at(b.anchor, { days: -90 }),
            sortOrder: 1,
        });
        const endedGoal = await b.createGoal(user, engineerRole, {
            title: 'Finish the v1 maintenance window',
            description: 'Wrapped up last quarter',
            startDate: b.at(b.anchor, { days: -300 }),
            endDate: b.at(b.anchor, { days: -60 }),
            sortOrder: 2,
        });
        const bePresent = await b.createGoal(user, fatherRole, {
            title: 'Be present on weekends',
            description: 'No laptop between Friday night and Monday morning',
            startDate: b.at(b.anchor, { days: -120 }),
        });
        const stayStrong = await b.createGoal(user, healthRole, {
            title: 'Run a half marathon',
            startDate: b.at(b.anchor, { days: -60 }),
        });
        // Deliberately has no active tasks under it, so "stalled" styling has a subject.
        const stalledGoal = await b.createGoal(user, healthRole, {
            title: 'Fix my sleep schedule',
            description: 'Nothing active underneath this one',
            startDate: b.at(b.anchor, { days: -45 }),
            sortOrder: 1,
        });

        const migrationProject = await b.createProject(user, shipV2, {
            title: 'Migration plan',
            description: 'Plan and execute the data migration',
            startDate: b.at(b.anchor, { days: -100 }),
        });
        const perfProject = await b.createProject(user, shipV2, {
            title: 'Perf pass',
            startDate: b.at(b.anchor, { days: -30 }),
            sortOrder: 1,
        });
        const hiringProject = await b.createProject(user, growTeam, {
            title: 'Hiring loop',
            startDate: b.at(b.anchor, { days: -80 }),
        });
        const weekendProject = await b.createProject(user, bePresent, {
            title: 'Weekend adventures',
            startDate: b.at(b.anchor, { days: -110 }),
        });
        const trainingProject = await b.createProject(user, stayStrong, {
            title: 'Training block',
            startDate: b.at(b.anchor, { days: -50 }),
        });
        // No start date: a parked "someday" item.
        const somedayProject = await b.createProject(user, shipV2, {
            title: 'Rewrite the CLI',
            description: 'Parked until v2 ships',
            startDate: null,
            sortOrder: 2,
        });
        const endedProject = await b.createProject(user, endedGoal, {
            title: 'v1 security patches',
            startDate: b.at(b.anchor, { days: -280 }),
            endDate: b.at(b.anchor, { days: -75 }),
        });
        // Under the stalled goal, and intentionally left with no tasks at all.
        const emptyProject = await b.createProject(user, stalledGoal, {
            title: 'Sleep hygiene experiments',
            startDate: b.at(b.anchor, { days: -40 }),
        });

        // Align some of the named tasks; the rest stay unaligned on purpose.
        await b.alignTasks([research, draft, publish], migrationProject);
        await b.alignTasks([proposal], perfProject);
        await b.alignTasks([codeReview, documentation], hiringProject);
        await b.alignTasks([backlogIdea], weekendProject);
        await b.alignTasks(active.slice(0, 6), trainingProject);
        await b.alignTasks(completed.slice(0, 12), migrationProject);

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
        const otherRole = await b.createRole(other.user, { title: 'OTHER USER SECRET ROLE' });
        const otherGoal = await b.createGoal(other.user, otherRole, { title: 'OTHER USER SECRET GOAL' });
        const otherProject = await b.createProject(other.user, otherGoal, {
            title: 'OTHER USER SECRET PROJECT',
        });

        return {
            primary,
            other,
            named: {
                proposal,
                codeReview,
                documentation,
                backlogIdea,
                research,
                draft,
                publish,
                zeroDuration,
                longerThanWorkday,
                overdue,
                unicode,
                longTitle,
                blocker,
                blocked,
                future,
                boundaryStart,
                boundaryEnd,
                meeting,
                clientCall,
                // Compass
                engineerRole,
                fatherRole,
                healthRole,
                endedRole,
                shipV2,
                growTeam,
                endedGoal,
                bePresent,
                stayStrong,
                stalledGoal,
                migrationProject,
                perfProject,
                hiringProject,
                weekendProject,
                trainingProject,
                somedayProject,
                endedProject,
                emptyProject,
                otherRole,
                otherGoal,
                otherProject,
            },
            counts: {
                active: active.length,
                backlog: backlog.length,
                repeating: repeating.length,
                completed: completed.length,
                events: events.length,
            },
        };
    },
};
