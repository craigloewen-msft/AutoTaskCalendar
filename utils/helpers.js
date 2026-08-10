const { wallTimeFromMinutes } = require('./temporal');

function returnFailure(messageString) {
    return { success: false, log: String(messageString) };
}

async function returnBasicUserInfo(inputUser) {
    inputUser = await inputUser.populate('taskList');
    return {
        username: inputUser.username, 
        email: inputUser.email, 
        _id: inputUser._id,
        timeZone: inputUser.timeZone,
        workingStartTime: wallTimeFromMinutes(inputUser.workingStartMinutes),
        workingEndTime: wallTimeFromMinutes(inputUser.workingEndMinutes),
        workingStartMinutes: inputUser.workingStartMinutes,
        workingEndMinutes: inputUser.workingEndMinutes,
        workingDays: inputUser.workingDays,
        selectedCalendars: inputUser.selectedCalendars
    };
}

module.exports = {
    returnFailure,
    returnBasicUserInfo
};
