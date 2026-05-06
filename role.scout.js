var creepUtils = require('utils.creep');
var remoteManager = require('manager.remote');

function getRoomCenter(roomName) {
    return new RoomPosition(25, 25, roomName);
}

function getHomeFallback(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return getRoomCenter(creep.memory.homeRoom);
    }

    var spawns = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || homeRoom.controller || getRoomCenter(homeRoom.name);
}

function moveToTargetRoom(creep) {
    creepUtils.moveTo(
        creep,
        getRoomCenter(creep.memory.targetRoom),
        '#88ddff',
        'scout',
        'move:scoutRoom'
    );
    return true;
}

function moveHome(creep) {
    creepUtils.moveTo(
        creep,
        getHomeFallback(creep),
        '#88ddff',
        'home',
        'move:scoutHome'
    );
    return true;
}

function rememberUnsafe(creep, reason) {
    if(creep.memory.homeRoom && creep.memory.targetRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.memory.targetRoom, reason || 'hostile threat');
    }
}

function retreatHome(creep, reason) {
    if(creep.room.name == creep.memory.targetRoom) {
        rememberUnsafe(creep, reason);
    }

    creepUtils.announceIntent(creep, 'action:scoutRetreat', 'retreat');
    return moveHome(creep);
}

function getScoutAnchor(creep) {
    if(creep.room.controller) {
        return creep.room.controller;
    }

    return getRoomCenter(creep.room.name);
}

var roleScout = {
    run: function(creep) {
        if(!creep.memory.homeRoom) {
            creep.memory.homeRoom = creep.room.name;
        }

        var nextTarget = remoteManager.getScoutTarget(creep.memory.homeRoom, creep.memory.targetRoom);
        if(nextTarget) {
            creep.memory.targetRoom = nextTarget;
        }
        else {
            delete creep.memory.targetRoom;
        }

        if(!creep.memory.targetRoom) {
            creepUtils.announceIntent(creep, 'action:idle', 'idle');
            return moveHome(creep);
        }

        if(remoteManager.hasThreats(creep.room)) {
            return retreatHome(creep, 'combat hostile');
        }

        if(creep.room.name == creep.memory.targetRoom && remoteManager.hasHostileTower(creep.room)) {
            return retreatHome(creep, 'hostile tower');
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return moveToTargetRoom(creep);
        }

        var scoutAnchor = getScoutAnchor(creep);
        if(creep.pos.getRangeTo(scoutAnchor) > 3) {
            creepUtils.announceIntent(creep, 'action:scoutAdvance', 'scout');
            creepUtils.moveTo(creep, scoutAnchor, '#88ddff', 'scan', 'move:scoutAnchor');
            return;
        }

        creepUtils.announceIntent(creep, 'action:scoutHold', 'scan');
    }
};

module.exports = roleScout;