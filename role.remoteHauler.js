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

function rememberUnsafe(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return;
    }

    var settings = remoteManager.getSettings(homeRoom);
    if(!settings.rooms[creep.memory.targetRoom]) {
        settings.rooms[creep.memory.targetRoom] = {};
    }

    settings.rooms[creep.memory.targetRoom].status = 'unsafe';
    settings.rooms[creep.memory.targetRoom].reason = 'hostile threat';
    settings.rooms[creep.memory.targetRoom].unsafeUntil = Game.time + settings.unsafeRoomCooldown;
}

function retreatHome(creep) {
    if(creep.room.name == creep.memory.targetRoom) {
        rememberUnsafe(creep);
    }
    creepUtils.announceIntent(creep, 'action:remoteRetreat', 'retreat');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'home', 'move:remoteRetreat');
    return true;
}

function moveToRemoteRoom(creep) {
    creepUtils.moveTo(
        creep,
        getRoomCenter(creep.memory.targetRoom),
        '#ffaa00',
        'remote',
        'move:remoteHaulRoom'
    );
    return true;
}

function idleAtHome(creep) {
    var target = getHomeFallback(creep);
    var targetPos = target.pos || target;
    if(target &&
        (creep.pos.roomName != targetPos.roomName ||
        creep.pos.getRangeTo(targetPos) > 8)) {
        creepUtils.moveTo(creep, target, '#66ccff', 'idle', 'move:remoteIdle');
        return true;
    }

    creepUtils.announceIntent(creep, 'action:idle', 'idle');
    return true;
}

var roleRemoteHauler = {
    run: function(creep) {
        if(remoteManager.hasThreats(creep.room)) {
            return retreatHome(creep);
        }

        if(creep.room.name == creep.memory.targetRoom && remoteManager.hasHostileTower(creep.room)) {
            return retreatHome(creep);
        }

        creepUtils.updateWorkingState(creep, 'deliver', 'haul');

        if(creep.memory.working) {
            if(remoteManager.deliverHome(creep)) {
                return;
            }

            return idleAtHome(creep);
        }

        var target = remoteManager.findRemoteEnergyTarget(creep, creep.memory.homeRoom);
        if(target) {
            return remoteManager.withdrawOrPickup(creep, target);
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return moveToRemoteRoom(creep);
        }

        return idleAtHome(creep);
    }
};

module.exports = roleRemoteHauler;
