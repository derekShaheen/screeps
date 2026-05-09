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
    remoteManager.moveToRoom(creep, creep.memory.targetRoom, '#66ffcc', 'reserve', 'move:reserveRoom');
    return true;
}

function moveHome(creep) {
    remoteManager.moveHome(creep, 'reserveHome');
    return true;
}

function retreatHome(creep, reason) {
    if(creep.room.name == creep.memory.targetRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.memory.targetRoom, reason || 'hostile threat');
    }

    creepUtils.announceIntent(creep, 'action:reserveRetreat', 'retreat');
    return moveHome(creep);
}

function reserveTargetRoom(creep) {
    var controller = creep.room.controller;
    if(!controller) {
        return moveHome(creep);
    }

    var result = creep.reserveController(controller);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.announceIntent(creep, 'action:reserveMove', 'reserve');
        creepUtils.moveTo(creep, controller, '#66ffcc', 'reserve', 'move:reserveController');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:reserveApply', 'claim');
        return true;
    }

    if(result == ERR_INVALID_TARGET) {
        return moveHome(creep);
    }

    creepUtils.announceIntent(creep, 'action:reserveWait', 'hold');
    return true;
}

var roleReserver = {
    run: function(creep) {
        if(!creep.memory.homeRoom) {
            creep.memory.homeRoom = creep.room.name;
        }

        var nextTarget = remoteManager.getReserverTarget(creep.memory.homeRoom, creep.memory.targetRoom);
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

        if(!remoteManager.isRemoteUsable(creep.memory.homeRoom, creep.memory.targetRoom)) {
            delete creep.memory.targetRoom;
            creepUtils.announceIntent(creep, 'action:idle', 'idle');
            return moveHome(creep);
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return moveToTargetRoom(creep);
        }

        return reserveTargetRoom(creep);
    }
};

module.exports = roleReserver;