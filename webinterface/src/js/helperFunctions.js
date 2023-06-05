export const helperFunctions = {
  changeShortCalendarFormatToDate(inString) {
    let returnDate = new Date(inString + "T00:00:00").toISOString();
    return returnDate;
  },
  changeDateToShortCalendarFormat(inDate) {
    let returnDate =
      inDate.getFullYear() +
      "-" +
      ("0" + (inDate.getMonth() + 1)).slice(-2) +
      "-" +
      ("0" + inDate.getDate()).slice(-2);

    return returnDate;
  },
};