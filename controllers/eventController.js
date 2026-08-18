const { UserDetails, EventDetails } = require('../models');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const { readGoogleCredentials, writeGoogleCredentials } = require('../utils/googleCredentials');
const {
  parseInstant,
  parseDateOnly,
  startOfDateInZone,
  normaliseTimeZone,
} = require('../utils/temporal');

function parseGoogleTimedInstant(value, timeZone) {
  const parsed = parseInstant(value);
  if (parsed.valid && parsed.date) return parsed.date;
  if (!value || !timeZone) return null;

  const local = moment.tz(
    value,
    moment.ISO_8601,
    true,
    normaliseTimeZone(timeZone)
  );
  return local.isValid() ? local.toDate() : null;
}

function transformGoogleEventData(eventData, fallbackTimeZone) {
  const allDay = !!(eventData.start?.date && eventData.end?.date);
  if (allDay) {
    const start = parseDateOnly(eventData.start.date);
    const end = parseDateOnly(eventData.end.date);
    if (!start.valid || !start.value || !end.valid || !end.value || end.value <= start.value) {
      throw new Error('Google all-day event has invalid dates');
    }
    const sourceTimeZone = normaliseTimeZone(
      eventData.start.timeZone || eventData.end.timeZone || fallbackTimeZone
    );
    return {
      allDay: true,
      allDayStart: start.value,
      allDayEnd: end.value,
      sourceTimeZone,
      startDate: startOfDateInZone(start.value, sourceTimeZone),
      endDate: startOfDateInZone(end.value, sourceTimeZone),
    };
  }

  const sourceTimeZone = eventData.start.timeZone || eventData.end.timeZone || fallbackTimeZone;
  const startDate = parseGoogleTimedInstant(eventData.start?.dateTime, sourceTimeZone);
  const endDate = parseGoogleTimedInstant(eventData.end?.dateTime, sourceTimeZone);
  if (!startDate || !endDate || endDate <= startDate) {
    throw new Error('Google timed event has invalid timestamps');
  }
  return {
    allDay: false,
    allDayStart: null,
    allDayEnd: null,
    sourceTimeZone,
    startDate,
    endDate,
  };
}

async function getEventListFromUsername(inUsername) {
  let user = await UserDetails.findOne({ username: inUsername }).populate('eventList');
  return user.eventList;
}

async function createEvent(userId, title, startDate, endDate, notes, type) {
  try {
    const event = new EventDetails({
      title,
      startDate,
      endDate,
      notes,
      type,
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
    await event.deleteOne();
  } catch (err) {
    throw new Error("Error deleting event");
  }
}

class GoogleAuthorizationFailure extends Error {}

function isGoogleAuthorizationError(error) {
  return Number(error?.code) === 401 || Number(error?.response?.status) === 401;
}

function createGoogleCalendarService(googleApi = google) {
  async function refreshGoogleCalendarAccessToken(inUser, config) {
    if (!config.googleOAuthClientID || !config.googleOAuthClientSecret) {
      throw new Error('Google OAuth credentials not configured');
    }

    const credentials = readGoogleCredentials(inUser, config);
    if (!credentials.refreshToken) throw new Error('No refresh token available');

    const oauth2Client = new googleApi.auth.OAuth2(
      config.googleOAuthClientID,
      config.googleOAuthClientSecret,
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });

    const tokens = await oauth2Client.refreshAccessToken();
    const accessToken = tokens?.credentials?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('Google token refresh returned no access token');
    }

    const refreshToken = tokens.credentials.refresh_token;
    writeGoogleCredentials(inUser, config, {
      accessToken,
      refreshToken: typeof refreshToken === 'string' && refreshToken.length > 0
        ? refreshToken
        : undefined,
    });
    await inUser.save();
    return accessToken;
  }

  function createCalendar(accessToken) {
    const auth = new googleApi.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return googleApi.calendar({ version: 'v3', auth });
  }

  function createRequest(inUser, config) {
    const credentials = readGoogleCredentials(inUser, config);
    if (!credentials.accessToken) throw new Error('No Google access token available');

    let accessToken = credentials.accessToken;
    let refreshAttempted = false;

    return {
      async run(operation) {
        try {
          return await operation(createCalendar(accessToken));
        } catch (error) {
          if (!isGoogleAuthorizationError(error)) throw error;
          if (refreshAttempted) throw new GoogleAuthorizationFailure();
          refreshAttempted = true;

          try {
            accessToken = await refreshGoogleCalendarAccessToken(inUser, config);
          } catch {
            throw new GoogleAuthorizationFailure();
          }

          try {
            return await operation(createCalendar(accessToken));
          } catch (retryError) {
            if (isGoogleAuthorizationError(retryError)) {
              throw new GoogleAuthorizationFailure();
            }
            throw retryError;
          }
        }
      },
    };
  }

  async function listGoogleCalendars(inUser, config) {
    const request = createRequest(inUser, config);
    const response = await request.run((calendar) => calendar.calendarList.list());
    return response.data.items;
  }

  async function fetchSelectedCalendarEvents(calendar, calendarIds, startPeriod, endPeriod) {
    const results = await Promise.allSettled(calendarIds.map(async (calendarId) => {
      const eventsResponse = await calendar.events.list({
        calendarId,
        timeMin: startPeriod.toISOString(),
        timeMax: endPeriod.toISOString(),
        maxResults: 2500,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (eventsResponse.data.items || []).map((event) => ({
        ...event,
        calendarId,
      }));
    }));
    const failures = results.filter((result) => result.status === 'rejected');
    const nonAuthorizationFailure = failures.find(
      (result) => !isGoogleAuthorizationError(result.reason)
    );
    if (nonAuthorizationFailure) throw nonAuthorizationFailure.reason;
    if (failures.length > 0) throw failures[0].reason;
    return results.flatMap((result) => result.value);
  }

  async function syncCalendarsToDatabase(inUser, startPeriod, endPeriod, config) {
    try {
      const request = createRequest(inUser, config);
      let calendarTimeZones = {};

      try {
        const entries = await request.run((calendar) => calendar.calendarList.list());
        calendarTimeZones = Object.fromEntries(
          (entries.data.items || []).map((entry) => [entry.id, entry.timeZone])
        );
      } catch (error) {
        if (error instanceof GoogleAuthorizationFailure) throw error;
        console.error('[Google OAuth] Could not load calendar timezones');
      }

      const eventsData = await request.run((calendar) => fetchSelectedCalendarEvents(
        calendar,
        inUser.selectedCalendars || [],
        startPeriod,
        endPeriod
      ));

      const events = await Promise.all(
        eventsData.map(async (eventData) => {
          const temporal = transformGoogleEventData(
            eventData,
            calendarTimeZones[eventData.organizer?.email] ||
              calendarTimeZones[eventData.calendarId] ||
              inUser.timeZone
          );
          return EventDetails.findOneAndUpdate(
            { externalEventID: eventData.id, userRef: inUser._id },
            {
              $set: {
                userRef: inUser._id,
                title: eventData.summary,
                notes: eventData.description,
                type: 'google',
                ...temporal,
              },
              $setOnInsert: { externalEventID: eventData.id },
            },
            { new: true, upsert: true }
          );
        })
      );

      await EventDetails.deleteMany({
        userRef: inUser._id,
        type: 'google',
        _id: { $nin: events.map((event) => event._id) }
      });

      return true;
    } catch (error) {
      console.error('[Google OAuth] Calendar sync failed');
      return false;
    }
  }

  return {
    listGoogleCalendars,
    refreshGoogleCalendarAccessToken,
    syncCalendarsToDatabase,
  };
}

const googleCalendarService = createGoogleCalendarService();

module.exports = {
  getEventListFromUsername,
  createEvent,
  updateEvent,
  deleteEvent,
  createGoogleCalendarService,
  listGoogleCalendars: googleCalendarService.listGoogleCalendars,
  refreshGoogleCalendarAccessToken: googleCalendarService.refreshGoogleCalendarAccessToken,
  syncCalendarsToDatabase: googleCalendarService.syncCalendarsToDatabase,
  transformGoogleEventData
};
