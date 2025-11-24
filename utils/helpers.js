function returnFailure(messageString) {
    return { success: false, log: messageString };
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
    returnBasicUserInfo
};
