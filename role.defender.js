var creepUtils = require('utils.creep');
var debug = require('utils.debug');

function findHostile(creep) {
    return creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
}

function getGuardTarget(creep) {
    var spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(spawn) {
        return spawn;
    }

    return creep.room.controller || creep;
}

function attackHostile(creep, hostile) {
    var result = creep.attack(hostile);
    if(result == ERR_NOT_IN_RANGE) {
        debug.log('debugDefense', creep.name + ' moving to defend against hostile in ' + creep.room.name, 3);
        creepUtils.moveTo(creep, hostile, '#ff3333', 'defend', 'move:defend');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:attack', 'attack');
        debug.log('debugDefense', creep.name + ' attacking hostile in ' + creep.room.name, 3);
        return true;
    }

    debug.log('debugDefense', creep.name + ' attack failed: ' + result, 5);
    return false;
}

function guardBase(creep) {
    var target = getGuardTarget(creep);
    if(creep.pos.getRangeTo(target) > 3) {
        creepUtils.moveTo(creep, target, '#ffcc00', 'guard', 'move:guard');
        return;
    }

    creepUtils.announceIntent(creep, 'action:guard', 'guard');
}

var roleDefender = {
    run: function(creep) {
        var hostile = findHostile(creep);
        if(hostile) {
            attackHostile(creep, hostile);
            return;
        }

        guardBase(creep);
    }
};

module.exports = roleDefender;
