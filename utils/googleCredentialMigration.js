'use strict';

const { UserDetails } = require('../models');
const { encryptGoogleCredential } = require('./googleCredentials');

async function migrateGoogleCredentials(config) {
    // Validate key material even when there is no legacy data to migrate.
    encryptGoogleCredential('startup-check', config.secret);

    const cursor = UserDetails.collection.find({
        $or: [
            { googleAccessToken: { $exists: true } },
            { googleRefreshToken: { $exists: true } },
        ],
    });

    for await (const user of cursor) {
        const set = {};
        if (!user.googleAccessTokenEncrypted && user.googleAccessToken) {
            set.googleAccessTokenEncrypted = encryptGoogleCredential(user.googleAccessToken, config.secret);
        }
        if (!user.googleRefreshTokenEncrypted && user.googleRefreshToken) {
            set.googleRefreshTokenEncrypted = encryptGoogleCredential(user.googleRefreshToken, config.secret);
        }

        const update = {
            $unset: { googleAccessToken: '', googleRefreshToken: '' },
        };
        if (Object.keys(set).length > 0) update.$set = set;
        await UserDetails.collection.updateOne({ _id: user._id }, update);
    }
}

module.exports = { migrateGoogleCredentials };
