const { UserDetails, EventDetails } = require('../models');
const { google } = require('googleapis');

async function getEventListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate('eventList');
    return user.eventList;
}

async function createEvent(userId, title, startDate, endDate, notes, type) {
    try {
        // Create the new event
        const event = new EventDetails({
            title: title,
            startDate: startDate,
            endDate: endDate,
            notes: notes,
            type: type,
            userRef: userId
        });
        await event.save();
        return event;
    } catch (error) {
        console.error(error);
        throw new Error("Error creating event");
    }
}

async function updateEvent(eventId, userId, title, startDate, endDate, notes) {
    try {
        const event = await EventDetails.findOne({ _id: eventId, userRef: userId });
        if (!event) {
            throw new Error("Event not found");
        }
        if (title) {
            event.title = title;
        }
        if (startDate) {
            event.startDate = startDate;
        }
        if (endDate) {
            event.endDate = endDate;
        }
        if (notes) {
            event.notes = notes;
        }

        await event.save();
        return event;
    } catch (err) {
        throw new Error("Error updating event");
    }
}

async function deleteEvent(eventId, userId) {
    try {
        const event = await EventDetails.findOne({ _id: eventId, userRef: userId });
        if (!event) {
            throw new Error("Event not found");
        }
        await event.remove();
    } catch (err) {
        throw new Error("Error deleting event");
    }
}

async function refreshGoogleCalendarAccessToken(inUser, config) {
    // Refresh Google Calendar access token
    const oauth2Client = new google.auth.OAuth2(
        config.googleOAuthClientID,
        config.googleOAuthClientSecret,
    );
    oauth2Client.setCredentials({
        refresh_token: inUser.googleRefreshToken
    });

    const tokens = await oauth2Client.refreshAccessToken();
    inUser.googleAccessToken = tokens.credentials.access_token;
    await inUser.save();

    return true;
}

async function syncCalendarsToDatabase(inUser, startPeriod, endPeriod, config) {
    try {
        // Check if user has a Google Calendar access token
        if (!inUser.googleAccessToken) {
            return false;
        }

        // Sync Google Calendar events to events database
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({
            access_token: inUser.googleAccessToken,
            refresh_token: inUser.googleRefreshToken
        });

        const calendar = google.calendar({ version: "v3", auth: oauth2Client });

        // Array of calendar IDs
        const calendarIds = inUser.selectedCalendars;

        // Array of promises that get events for each calendar
        const eventsPromises = calendarIds.map(async (calendarId) => {
            const eventsResponse = await calendar.events.list({
                calendarId,
                timeMin: startPeriod.toISOString(),
                timeMax: endPeriod.toISOString(),
                maxResults: 2500,
                singleEvents: true,
                orderBy: "startTime",
            });
            return eventsResponse.data.items;
        });

        // Wait for all promises to resolve
        const eventsResults = await Promise.all(eventsPromises);

        // Merge events from all calendars into one array
        const eventsResponse = eventsResults.reduce((accumulator, currentValue) => {
            return [...accumulator, ...currentValue];
        }, []);

        const eventsData = eventsResponse;

        const events = await Promise.all(
            eventsData.map(async (eventData) => {
                let event = await EventDetails.findOne({
                    externalEventID: eventData.id,
                    userRef: inUser._id
                });

                if (!event) {
                    event = new EventDetails({
                        externalEventID: eventData.id,
                        userRef: inUser._id,
                        title: eventData.summary,
                        startDate: eventData.start.dateTime || eventData.start.date,
                        endDate: eventData.end.dateTime || eventData.end.date,
                        notes: eventData.description,
                        type: "google"
                    });
                    await event.save();
                }

                return event;
            })
        );

        let eventIds = events.map((event) => event._id);

        // Delete all events that are not in the Google Calendar
        let deleteResult = await EventDetails.deleteMany({
            userRef: inUser._id,
            type: "google",
            _id: { $nin: eventIds }
        });

        return true;

    } catch (err) {
        console.error(err);

        if (err.code == 401) {
            await refreshGoogleCalendarAccessToken(inUser, config);
            // Try again
            return syncCalendarsToDatabase(inUser, startPeriod, endPeriod, config);
        }

        return false;
    }
}

module.exports = {
    getEventListFromUsername,
    createEvent,
    updateEvent,
    deleteEvent,
    refreshGoogleCalendarAccessToken,
    syncCalendarsToDatabase
};
