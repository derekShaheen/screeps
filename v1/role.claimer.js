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
    remoteManager.moveToRoom(creep, creep.memory.targetRoom, '#99ff99', 'claim', 'move:claimRoom');
    return true;
}

function moveHome(creep) {
    remoteManager.moveHome(creep, 'claimHome');
    return true;
}

function retreatHome(creep, reason) {
    if(creep.room.name == creep.memory.targetRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.memory.targetRoom, reason || 'hostile threat');
    }

    creepUtils.announceIntent(creep, 'action:claimRetreat', 'retreat');
    return moveHome(creep);
}

function claimTargetRoom(creep) {
    var controller = creep.room.controller;
    if(!controller) {
        return moveHome(creep);
    }

    if(controller.my) {
        delete creep.memory.targetRoom;
        creepUtils.announceIntent(creep, 'action:claimDone', 'done');
        return moveHome(creep);
    }

    var result = creep.claimController(controller);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.announceIntent(creep, 'action:claimMove', 'claim');
        creepUtils.moveTo(creep, controller, '#99ff99', 'claim', 'move:claimController');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:claimApply', 'claim');
        return true;
    }

    if(result == ERR_GCL_NOT_ENOUGH || result == ERR_INVALID_TARGET) {
        delete creep.memory.targetRoom;
        return moveHome(creep);
    }

    creepUtils.announceIntent(creep, 'action:claimWait', 'hold');
    return true;
}

var roleClaimer = {
    run: function(creep) {
        if(!creep.memory.homeRoom) {
            creep.memory.homeRoom = creep.room.name;
        }

        var nextTarget = remoteManager.getClaimerTarget(creep.memory.homeRoom, creep.memory.targetRoom);
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

        return claimTargetRoom(creep);
    }
};

module.exports = roleClaimer;