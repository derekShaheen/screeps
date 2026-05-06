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

function retreatHome(creep) {
    if(creep.room.name == creep.memory.targetRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.memory.targetRoom, 'hostile threat');
    }
    creepUtils.announceIntent(creep, 'action:remoteRetreat', 'retreat');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'home', 'move:remoteRetreat');
    return true;
}

function abortBlockedRemote(creep) {
    creepUtils.announceIntent(creep, 'action:remoteAbort', 'blocked');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'blocked', 'move:remoteBlocked');
    return true;
}

function moveToRemoteRoom(creep) {
    remoteManager.moveToRoom(creep, creep.memory.targetRoom, '#ffaa00', 'remote', 'move:remoteHaulRoom');
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

function hasOwnedSpawn(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    }).length > 0;
}

function isBootstrapTargetRoom(creep) {
    return creep.room.name == creep.memory.targetRoom &&
        creep.room.controller &&
        creep.room.controller.my &&
        !hasOwnedSpawn(creep.room);
}

function getBootstrapWorkerPriority(creep) {
    if(creep.memory.role == 'builder') {
        return 1;
    }

    if(creep.memory.role == 'upgrader') {
        return 2;
    }

    if(creep.memory.role == 'harvester') {
        return 3;
    }

    return 99;
}

function findBootstrapWorkerTarget(creep) {
    var candidates = creep.room.find(FIND_MY_CREEPS, {
        filter: function(otherCreep) {
            if(otherCreep.name == creep.name || otherCreep.spawning) {
                return false;
            }

            if(otherCreep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
                return false;
            }

            return otherCreep.memory.role == 'builder' ||
                otherCreep.memory.role == 'upgrader' ||
                otherCreep.memory.role == 'harvester';
        }
    });

    if(!candidates.length) {
        return null;
    }

    candidates.sort(function(a, b) {
        var priorityDiff = getBootstrapWorkerPriority(a) - getBootstrapWorkerPriority(b);
        if(priorityDiff !== 0) {
            return priorityDiff;
        }

        var freeCapacityDiff = b.store.getFreeCapacity(RESOURCE_ENERGY) - a.store.getFreeCapacity(RESOURCE_ENERGY);
        if(freeCapacityDiff !== 0) {
            return freeCapacityDiff;
        }

        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    return candidates[0];
}

var roleRemoteHauler = {
    run: function(creep) {
        if(remoteManager.hasThreats(creep.room)) {
            return retreatHome(creep);
        }

        if(!remoteManager.isRemoteUsable(creep.memory.homeRoom, creep.memory.targetRoom)) {
            return abortBlockedRemote(creep);
        }

        if(creep.room.name == creep.memory.targetRoom && remoteManager.hasHostileTower(creep.room)) {
            return retreatHome(creep);
        }

        creepUtils.updateWorkingState(creep, 'deliver', 'haul');

        if(creep.memory.working) {
            if(isBootstrapTargetRoom(creep)) {
                var bootstrapWorker = findBootstrapWorkerTarget(creep);
                if(bootstrapWorker) {
                    return creepUtils.transferEnergy(creep, bootstrapWorker);
                }

                return true;
            }

            if(remoteManager.deliverHome(creep)) {
                return;
            }

            return idleAtHome(creep);
        }

        var target = remoteManager.findRemoteEnergyTarget(creep, creep.memory.homeRoom, creep.memory.targetRoom);
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
