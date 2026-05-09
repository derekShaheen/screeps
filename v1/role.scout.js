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
    remoteManager.moveToRoom(creep, creep.memory.targetRoom, '#88ddff', 'scout', 'move:scoutRoom');
    return true;
}

function moveHome(creep) {
    remoteManager.moveHome(creep, 'scoutHome');
    return true;
}

function rememberUnsafe(creep, reason) {
    if(creep.memory.homeRoom && creep.memory.targetRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.memory.targetRoom, reason || 'hostile threat');
    }
}

function rememberScoutCooldown(creep) {
    if(!creep.memory.homeRoom || !creep.memory.targetRoom) {
        return;
    }

    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return;
    }

    var settings = remoteManager.getSettings(homeRoom);
    creep.memory.blockedTargetRoom = creep.memory.targetRoom;
    creep.memory.blockedTargetUntil = Game.time + Math.max(settings.unsafeRoomCooldown, settings.staleRoomTicks || 0);
}

function isBlockedScoutTarget(creep, roomName) {
    return !!roomName &&
        creep.memory.blockedTargetRoom == roomName &&
        creep.memory.blockedTargetUntil &&
        Game.time < creep.memory.blockedTargetUntil;
}

function clearExpiredScoutCooldown(creep) {
    if(creep.memory.blockedTargetUntil && Game.time >= creep.memory.blockedTargetUntil) {
        delete creep.memory.blockedTargetRoom;
        delete creep.memory.blockedTargetUntil;
    }
}

function retreatHome(creep, reason) {
    if(creep.room.name == creep.memory.targetRoom) {
        rememberUnsafe(creep, reason);
        rememberScoutCooldown(creep);
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

        clearExpiredScoutCooldown(creep);

        var nextTarget = remoteManager.getScoutTarget(creep.memory.homeRoom, creep.memory.targetRoom);
        if(isBlockedScoutTarget(creep, nextTarget)) {
            nextTarget = null;
        }
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

        if(!remoteManager.isRemoteScoutable(creep.memory.homeRoom, creep.memory.targetRoom)) {
            rememberScoutCooldown(creep);
            delete creep.memory.targetRoom;
            creepUtils.announceIntent(creep, 'action:idle', 'idle');
            return moveHome(creep);
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