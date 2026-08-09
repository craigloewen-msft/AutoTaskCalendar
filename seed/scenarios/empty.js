'use strict';

/**
 * A registered user with nothing else. Use this for empty-state UI and for tests that
 * create all their own data.
 */
module.exports = {
    name: 'empty',
    description: 'One user, no tasks and no events. Empty-state coverage.',

    async build(b) {
        const primary = await b.createUser();
        return { primary };
    },
};
