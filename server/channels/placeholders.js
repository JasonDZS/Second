"use strict";

const placeholderAdapters = [
  placeholder("linear", "Linear", "Issue assignment, comments, and status sync adapter placeholder."),
  placeholder("clickup", "ClickUp", "Task assignment and recurring task adapter placeholder."),
];

function placeholder(id, name, description) {
  return {
    id,
    name,
    kind: "placeholder",
    status: "not_implemented",
    description,
    httpPrefix: null,
    supports: {
      taskIntake: false,
      decisionButtons: false,
      resultReply: false,
      socketMode: false,
    },
  };
}

module.exports = {
  placeholder,
  placeholderAdapters,
};
