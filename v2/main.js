var config = require('v2.config');
var construction = require('v2.construction');
var intel = require('v2.intel');
var memory = require('v2.memory');
var movement = require('v2.movement');
var roles = require('v2.roles');
var spawn = require('v2.spawn');
var visuals = require('v2.visuals');

module.exports.loop = function() {
    memory.cleanupCreeps();
    intel.observeVisibleRooms();
    movement.decayUsage();
    spawn.run();
    roles.runAll(movement);
    intel.observeVisibleRooms();
    construction.run();
    visuals.draw();
    memory.scrubUndefined(Memory[config.memoryKey]);
};
