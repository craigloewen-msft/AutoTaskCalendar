function returnFailure(messageString) {
    return { success: false, log: messageString };
}

/**
 * Parse a user-supplied date without deciding what to do about a bad one.
 *
 * Returns `{ provided, valid, date }` so callers can tell "not given" apart from "given
 * but unusable" and apply their own policy: required-field errors, silent fallbacks, or
 * ignoring the value entirely.
 */
function parseDate(value) {
    if (value === undefined || value === null || value === '') {
        return { provided: false, valid: true, date: null };
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return { provided: true, valid: false, date: null };
    }

    return { provided: true, valid: true, date };
}

async function returnBasicUserInfo(inputUser) {
    inputUser = await inputUser.populate('taskList');
    return {
        username: inputUser.username, 
        email: inputUser.email, 
        _id: inputUser._id, 
        workingStartTime: inputUser.workingStartTime,
        workingDuration: inputUser.workingDuration, 
        workingDays: inputUser.workingDays, 
        selectedCalendars: inputUser.selectedCalendars
    };
}

module.exports = {
    returnFailure,
    parseDate,
    returnBasicUserInfo
};
