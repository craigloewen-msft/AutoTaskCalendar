const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { UserDetails } = require('../models');
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

function createEventRoutes(config, authenticateToken) {

  router.post('/createEvent', authenticateToken, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.id });

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

  router.post('/updateEvent', authenticateToken, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.id });

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

  router.post('/deleteEvent', authenticateToken, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.id });

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
      const returnEventList = await getEventListFromUsername(req.user.id);
      return res.json({ success: true, eventList: returnEventList });
    } catch (err) {
      res.send(returnFailure(err.message));
    }
  });

  router.get('/getUserEvents/:date', authenticateToken, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.id });

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

  router.get('/connectGoogle', authenticateToken, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
      console.error('[Google OAuth] User not logged in or not found');
      return res.send(returnFailure('Not logged in'));
    }

    // Check for missing configuration
    if (!config.appUrl) {
      console.error('[Google OAuth] ERROR: config.appUrl is not set! This will cause OAuth to fail.');
      return res.send(returnFailure('Server configuration error: appUrl not set'));
    }
    if (!config.googleOAuthClientID || !config.googleOAuthClientSecret) {
      console.error('[Google OAuth] ERROR: Google OAuth credentials not configured');
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

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: user._id.toString(),
      prompt: 'consent',
    });

    console.log('[Google OAuth] Generated auth URL (first 100 chars):', authUrl.substring(0, 100) + '...');
    return res.send({ authUrl });
  });

  router.get('/connectGoogleCallback', async (req, res) => {

    // Check if Google returned an error
    if (req.query.error) {
      console.error('[Google OAuth] ERROR: Google returned error:', req.query.error);
      console.error('[Google OAuth] Error description:', req.query.error_description || 'none provided');
      return res.redirect(`${config.appUrl}?error=oauth_error`);
    }

    // Check if authorization code is present
    if (!req.query.code) {
      console.error('[Google OAuth] ERROR: Missing authorization code in callback');
      return res.redirect(`${config.appUrl}?error=missing_code`);
    }

    // Get the user's ID from the state parameter
    const userId = req.query.state;

    if (!userId) {
      console.error('[Google OAuth] ERROR: Missing state parameter in callback');
      return res.redirect(`${config.appUrl}?error=invalid_state`);
    }

    // Check if user exists
    let user = await UserDetails.findById(userId);

    if (!user) {
      console.error('[Google OAuth] ERROR: User not found for ID:', userId);
      return res.redirect(`${config.appUrl}?error=user_not_found`);
    }

    const redirectUri = `${config.appUrl}/api/connectGoogleCallback`;

    // Exchange the authorization code for an access token
    const oauth2Client = new google.auth.OAuth2(
      config.googleOAuthClientID,
      config.googleOAuthClientSecret,
      redirectUri
    );

    try {
      const { tokens } = await oauth2Client.getToken(req.query.code);

      // Save the access and refresh tokens in the user's document
      user.googleAccessToken = tokens.access_token;
      user.googleRefreshToken = tokens.refresh_token;
      await user.save();

      console.log('[Google OAuth] Tokens saved to user document, redirecting to:', config.appUrl);
      return res.redirect(`${config.appUrl}`);
    } catch (err) {
      console.error('[Google OAuth] ERROR: Failed to exchange authorization code for tokens');
      console.error('[Google OAuth] Error message:', err.message);
      console.error('[Google OAuth] Error details:', JSON.stringify(err.response?.data || err, null, 2));
      return res.redirect(`${config.appUrl}?error=token_exchange_failed`);
    }
  });

  router.get('/getCalendars', authenticateToken, async (req, res) => {
    console.log('[Google OAuth] /getCalendars called');
    try {
      const user = await UserDetails.findOne({ username: req.user.id });
      if (!user || !user.googleAccessToken) {
        console.error('[Google OAuth] ERROR: User not authenticated with Google or no access token');
        return res.send(returnFailure('User is not authenticated with Google'));
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: user.googleAccessToken });
      const calendar = google.calendar({ version: 'v3', auth });

      let calendarListResponse = null;
      try {
        calendarListResponse = await calendar.calendarList.list();
      } catch (err) {
        console.error('[Google OAuth] Calendar list failed with error code:', err.code);
        console.error('[Google OAuth] Error message:', err.message);
        if (err.code == 401) {
          await refreshGoogleCalendarAccessToken(user, config);
          auth.setCredentials({ access_token: user.googleAccessToken });
          calendarListResponse = await calendar.calendarList.list();
        } else {
          throw err;
        }
      }
      const calendars = calendarListResponse.data.items;

      return res.json({ success: true, calendars });
    } catch (err) {
      console.error('[Google OAuth] ERROR in /getCalendars:', err.message);
      return res.send(returnFailure(err.message));
    }
  });

  router.get('/synccalendar', authenticateToken, async (req, res) => {
    try {
      let user = await UserDetails.findOne({ username: req.user.id });

      if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
      }

      let now = new Date();
      let twoWeeksBefore = new Date(now.getTime() - 12096e5);
      let monthAfter = new Date(now.getTime() + 2629800000);

      let calendarTimeZones = {};
      try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: user.googleAccessToken });
        const calendar = google.calendar({ version: 'v3', auth });
        const entries = await calendar.calendarList.list();
        calendarTimeZones = Object.fromEntries(
          (entries.data.items || []).map((entry) => [entry.id, entry.timeZone])
        );
      } catch (error) {
        console.error('[Google OAuth] Could not load calendar timezones:', error.message);
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
      console.error(err);
      return res.send(returnFailure(err.message));
    }
  });

  return router;
}

module.exports = createEventRoutes;
