var creepUtils = require('utils.creep');
var debug = require('utils.debug');
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
    if(creep.room.name != creep.memory.homeRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.room.name, 'hostile threat');
    }
    creepUtils.announceIntent(creep, 'action:remoteRetreat', 'retreat');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'home', 'move:remoteRetreat');
    return true;
}

function abortBlockedRemote(creep) {
    debug.log(
        'debugRoles',
        creep.name + ' remote hauler returning home because ' +
            creep.memory.targetRoom + ' is blocked or not workable',
        3
    );
    creepUtils.announceIntent(creep, 'action:remoteAbort', 'blocked');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'blocked', 'move:remoteBlocked');
    return true;
}

function shouldAbortAssignedRemote(creep) {
    if(!creep.memory.homeRoom || !creep.memory.targetRoom) {
        return true;
    }

    if(!remoteManager.isRemoteWorkable(creep.memory.homeRoom, creep.memory.targetRoom)) {
        return true;
    }

    var targetRoom = Game.rooms[creep.memory.targetRoom];
    if(!targetRoom) {
        return false;
    }

    return !remoteManager.canHarvestRemoteRoom(targetRoom);
}

function moveToRemoteRoom(creep) {
    if(creep.room.name != creep.memory.targetRoom &&
        Game.map &&
        typeof Game.map.findExit == 'function') {
        var exit = Game.map.findExit(creep.room, creep.memory.targetRoom);
        if(exit >= 0) {
            var exitPos = creep.pos.findClosestByPath(exit);
            if(exitPos) {
                creepUtils.moveTo(creep, exitPos, '#ffaa00', 'remote', 'move:remoteHaulExit');
                return true;
            }
        }
    }

    remoteManager.moveToRoom(creep, creep.memory.targetRoom, '#ffaa00', 'remote', 'move:remoteHaulRoom');
    return true;
}

function moveToHomeRoom(creep) {
    if(creep.room.name == creep.memory.homeRoom) {
        return false;
    }

    if(Game.map && typeof Game.map.findExit == 'function') {
        var exit = Game.map.findExit(creep.room, creep.memory.homeRoom);
        if(exit >= 0) {
            var exitPos = creep.pos.findClosestByPath(exit);
            if(exitPos) {
                creepUtils.moveTo(creep, exitPos, '#ffffff', 'home', 'move:remoteHaulHomeExit');
                return true;
            }
        }
    }

    remoteManager.moveHome(creep, 'remoteHaulHome');
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

function idleInRemote(creep) {
    if(creep.room.name != creep.memory.targetRoom) {
        return moveToRemoteRoom(creep);
    }

    debug.log(
        'debugRoles',
        creep.name + ' waiting in remote room ' + creep.memory.targetRoom + ' for haulable energy',
        10
    );
    creepUtils.announceIntent(creep, 'action:remoteWaitEnergy', 'wait');
    return true;
}

function rememberRemoteEnergyTarget(creep, target) {
    if(!target || !target.id) {
        delete creep.memory.remoteEnergyTargetId;
        return;
    }

    creep.memory.remoteEnergyTargetId = target.id;
}

function getRememberedRemoteEnergyTarget(creep) {
    if(!creep.memory.remoteEnergyTargetId) {
        return null;
    }

    var target = Game.getObjectById(creep.memory.remoteEnergyTargetId);
    if(!target ||
        !target.pos ||
        target.pos.roomName != creep.memory.targetRoom ||
        (target.store && target.store[RESOURCE_ENERGY] <= 0) ||
        (target.resourceType && target.amount <= 0)) {
        delete creep.memory.remoteEnergyTargetId;
        return null;
    }

    return target;
}

function findRemoteEnergyTarget(creep) {
    var remembered = getRememberedRemoteEnergyTarget(creep);
    if(remembered) {
        return remembered;
    }

    var target = remoteManager.findRemoteEnergyTarget(creep, creep.memory.homeRoom, creep.memory.targetRoom);
    if(!target) {
        target = remoteManager.findRemoteEnergyTarget(creep, creep.memory.homeRoom, null);
        if(target && target.pos && target.pos.roomName != creep.memory.targetRoom) {
            debug.log(
                'debugRoles',
                creep.name + ' retargeting remote haul from ' +
                    creep.memory.targetRoom + ' to ' + target.pos.roomName +
                    ' for visible energy',
                3
            );
            creep.memory.targetRoom = target.pos.roomName;
            delete creep.memory.moveState;
        }
    }

    rememberRemoteEnergyTarget(creep, target);
    return target;
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

        if(shouldAbortAssignedRemote(creep)) {
            return abortBlockedRemote(creep);
        }

        if(creep.room.name == creep.memory.targetRoom && remoteManager.hasHostileTower(creep.room)) {
            return retreatHome(creep);
        }

        creepUtils.updateWorkingState(creep, 'deliver', 'haul');

        if(creep.memory.working) {
            delete creep.memory.remoteEnergyTargetId;

            if(creep.room.name != creep.memory.homeRoom) {
                return moveToHomeRoom(creep);
            }

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

        var target = findRemoteEnergyTarget(creep);
        if(target) {
            return remoteManager.withdrawOrPickup(creep, target);
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return moveToRemoteRoom(creep);
        }

        return idleInRemote(creep);
    }
};

module.exports = roleRemoteHauler;
