const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { google } = require('googleapis');
const { UserDetails, GoogleOAuthStateDetails } = require('../models');
const { readGoogleCredentials, writeGoogleCredentials } = require('../utils/googleCredentials');
const { returnFailure } = require('../utils/helpers');
const { parseInstant, localWeekBounds } = require('../utils/temporal');
const {
  getEventListFromUsername,
  createEvent,
  updateEvent,
  deleteEvent,
  refreshGoogleCalendarAccessToken,
  syncCalendarsToDatabase
} = require('../controllers/eventController');

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function invalidStateRedirect(res, config) {
  return res.redirect(`${config.appUrl}?error=invalid_state`);
}

function createEventRoutes(config, authenticateSession) {

  router.post('/createEvent', authenticateSession, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.username });

    if (!req.user || !user) {
      return res.send(returnFailure('Not logged in'));
    }

    const { title, startDate, endDate, notes } = req.body;
    if (!title || !startDate || !endDate) {
      return res.send(returnFailure('Title, start date, and end date are required'));
    }
    const start = parseInstant(startDate);
    const end = parseInstant(endDate);
    if (!start.valid || !start.date || !end.valid || !end.date) {
      return res.send(returnFailure('Start date and end date must be valid timestamps'));
    }
    if (end.date <= start.date) {
      return res.send(returnFailure('End date must be after start date'));
    }

    try {
      const event = await createEvent(user._id, title, start.date, end.date, notes, 'calendar');
      return res.json({ success: true, event });
    } catch (error) {
      console.error(error);
      return res.json({ success: false });
    }
  });

  router.post('/updateEvent', authenticateSession, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.username });

    if (!user) {
      return res.send(returnFailure('Not logged in'));
    }

    const { eventId, title, startDate, endDate, notes } = req.body;
    if (!eventId) {
      return res.send(returnFailure('Event id is required'));
    }

    try {
      const existing = await require('../models').EventDetails.findOne({ _id: eventId, userRef: user._id });
      if (!existing) return res.send(returnFailure('Event not found'));
      const parsedStart = startDate !== undefined ? parseInstant(startDate) : { valid: true, date: existing.startDate };
      const parsedEnd = endDate !== undefined ? parseInstant(endDate) : { valid: true, date: existing.endDate };
      if (!parsedStart.valid || !parsedStart.date || !parsedEnd.valid || !parsedEnd.date) {
        return res.send(returnFailure('Start date and end date must be valid timestamps'));
      }
      if (parsedEnd.date <= parsedStart.date) {
        return res.send(returnFailure('End date must be after start date'));
      }
      const event = await updateEvent(
        eventId,
        user._id,
        title,
        startDate !== undefined ? parsedStart.date : undefined,
        endDate !== undefined ? parsedEnd.date : undefined,
        notes
      );
      res.send({ success: true, event });
    } catch (err) {
      res.send(returnFailure(err.message));
    }
  });

  router.post('/deleteEvent', authenticateSession, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.username });

    if (!req.user || !user) {
      return res.send(returnFailure('Not logged in'));
    }

    const { eventId } = req.body;
    if (!eventId) {
      return res.send(returnFailure('Event id is required'));
    }

    try {
      await deleteEvent(eventId, user._id);
      // Return the updated event list
      const returnEventList = await getEventListFromUsername(req.user.username);
      return res.json({ success: true, eventList: returnEventList });
    } catch (err) {
      res.send(returnFailure(err.message));
    }
  });

  router.get('/getUserEvents/:date', authenticateSession, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.username });

    if (!req.user || !user) {
      return res.send(returnFailure('Not logged in'));
    }
    try {
      const { EventDetails } = require('../models');
      const bounds = localWeekBounds(req.params.date, user.timeZone);
      if (!bounds) {
        return res.send(returnFailure('A valid date is required'));
      }

      const events = await EventDetails.find({
        userRef: user._id,
        startDate: { $lt: bounds.end },
        endDate: { $gt: bounds.start },
      });

      return res.json({ success: true, events });
    } catch (err) {
      console.error(err);
      return res.send(returnFailure(err.message));
    }
  });

  router.get('/connectGoogle', authenticateSession, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.username });

    if (!req.user || !user) return res.send(returnFailure('Not logged in'));

    if (!config.appUrl) return res.send(returnFailure('Server configuration error: appUrl not set'));
    if (!config.googleOAuthClientID || !config.googleOAuthClientSecret) {
      return res.send(returnFailure('Server configuration error: Google OAuth not configured'));
    }

    const redirectUri = `${config.appUrl}/api/connectGoogleCallback`;

    // Generate a URL for the user to connect their Google account
    const oauth2Client = new google.auth.OAuth2(
      config.googleOAuthClientID,
      config.googleOAuthClientSecret,
      redirectUri
    );

    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
    ];

    const state = crypto.randomBytes(32).toString('base64url');
    const sessionDigest = digest(req.sessionID);
    await GoogleOAuthStateDetails.findOneAndUpdate(
      { userRef: user._id, sessionDigest },
      {
        $set: {
          stateDigest: digest(state),
          expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        },
        $setOnInsert: { userRef: user._id, sessionDigest },
      },
      { upsert: true }
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state,
      prompt: 'consent',
    });

    return res.send({ authUrl });
  });

  router.get('/connectGoogleCallback', async (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user || !req.sessionID) {
      return invalidStateRedirect(res, config);
    }
    if (typeof req.query.state !== 'string' || req.query.state.length === 0) {
      return invalidStateRedirect(res, config);
    }

    const state = await GoogleOAuthStateDetails.findOneAndDelete({
      stateDigest: digest(req.query.state),
      userRef: req.user._id,
      sessionDigest: digest(req.sessionID),
      expiresAt: { $gt: new Date() },
    });
    if (!state) return invalidStateRedirect(res, config);

    if (req.query.error) return res.redirect(`${config.appUrl}?error=oauth_error`);
    if (!req.query.code) return res.redirect(`${config.appUrl}?error=missing_code`);

    const user = await UserDetails.findById(req.user._id);
    if (!user) return invalidStateRedirect(res, config);

    const redirectUri = `${config.appUrl}/api/connectGoogleCallback`;

    // Exchange the authorization code for an access token
    const oauth2Client = new google.auth.OAuth2(
      config.googleOAuthClientID,
      config.googleOAuthClientSecret,
      redirectUri
    );

    try {
      const { tokens } = await oauth2Client.getToken(req.query.code);

      writeGoogleCredentials(user, config, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
      await user.save();

      return res.redirect(`${config.appUrl}`);
    } catch (err) {
      console.error('[Google OAuth] Token exchange failed');
      return res.redirect(`${config.appUrl}?error=token_exchange_failed`);
    }
  });

  router.get('/getCalendars', authenticateSession, async (req, res) => {
    try {
      const user = await UserDetails.findOne({ username: req.user.username });
      if (!user) return res.send(returnFailure('User is not authenticated with Google'));
      const credentials = readGoogleCredentials(user, config);
      if (!credentials.accessToken) {
        return res.send(returnFailure('User is not authenticated with Google'));
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: credentials.accessToken });
      const calendar = google.calendar({ version: 'v3', auth });

      let calendarListResponse = null;
      try {
        calendarListResponse = await calendar.calendarList.list();
      } catch (err) {
        if (err.code == 401) {
          await refreshGoogleCalendarAccessToken(user, config);
          const refreshed = readGoogleCredentials(user, config);
          auth.setCredentials({ access_token: refreshed.accessToken });
          calendarListResponse = await calendar.calendarList.list();
        } else {
          throw err;
        }
      }
      const calendars = calendarListResponse.data.items;

      return res.json({ success: true, calendars });
    } catch (err) {
      console.error('[Google OAuth] Calendar listing failed');
      return res.send(returnFailure('Could not load Google calendars'));
    }
  });

  router.get('/synccalendar', authenticateSession, async (req, res) => {
    try {
      let user = await UserDetails.findOne({ username: req.user.username });

      if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
      }

      let now = new Date();
      let twoWeeksBefore = new Date(now.getTime() - 12096e5);
      let monthAfter = new Date(now.getTime() + 2629800000);

      let calendarTimeZones = {};
      try {
        const auth = new google.auth.OAuth2();
        const credentials = readGoogleCredentials(user, config);
        auth.setCredentials({ access_token: credentials.accessToken });
        const calendar = google.calendar({ version: 'v3', auth });
        const entries = await calendar.calendarList.list();
        calendarTimeZones = Object.fromEntries(
          (entries.data.items || []).map((entry) => [entry.id, entry.timeZone])
        );
      } catch (error) {
        console.error('[Google OAuth] Could not load calendar timezones');
      }

      await syncCalendarsToDatabase(
        user,
        twoWeeksBefore,
        monthAfter,
        config,
        calendarTimeZones
      );

      return res.send({ success: true });
    } catch (err) {
      console.error('[Google OAuth] Calendar sync request failed');
      return res.send(returnFailure('Could not sync Google calendars'));
    }
  });

  return router;
}

module.exports = createEventRoutes;
