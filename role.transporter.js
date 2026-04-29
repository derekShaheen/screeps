var creepUtils = require('utils.creep');
var debug = require('utils.debug');

var TOWER_PEACE_REFILL_TARGET = 600;

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function isSourceContainer(structure) {
    return structure.structureType == STRUCTURE_CONTAINER &&
        structure.pos.findInRange(FIND_SOURCES, 1).length > 0;
}

function isControllerContainer(structure) {
    return structure.structureType == STRUCTURE_CONTAINER &&
        structure.room.controller &&
        structure.pos.getRangeTo(structure.room.controller) <= 3 &&
        !isSourceContainer(structure);
}

function findSourceEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            return isSourceContainer(structure) &&
                creepUtils.getAvailableStoredEnergy(creep, structure) > 0 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function findFallbackStoredEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            if(!structure.store || creepUtils.getAvailableStoredEnergy(creep, structure) <= 0) {
                return false;
            }

            if(isControllerContainer(structure)) {
                return false;
            }

            return (structure.structureType == STRUCTURE_CONTAINER ||
                structure.structureType == STRUCTURE_STORAGE) &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function withdrawEnergy(creep, target) {
    if(!creepUtils.reserveEnergyTarget(creep, target)) {
        debug.log('debugRoles', creep.name + ' skipped fully reserved energy at ' + formatPos(target.pos), 5);
        return false;
    }

    var result = creep.withdraw(target, RESOURCE_ENERGY);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#ffaa00', 'go haul', 'move:haul');
        return true;
    }

    if(result == OK) {
        creepUtils.releaseEnergyReservation(creep);
        creepUtils.announceIntent(creep, 'action:haul', 'haul');
        debug.log('debugRoles', creep.name + ' withdrew energy from ' + target.structureType + ' at ' + formatPos(target.pos), 5);
        return true;
    }

    if(result == ERR_NOT_ENOUGH_RESOURCES || result == ERR_INVALID_TARGET) {
        creepUtils.releaseEnergyReservation(creep);
    }

    debug.log('debugRoles', creep.name + ' withdraw failed from ' + target.structureType + ': ' + result, 5);
    return false;
}

function findSpawnFillTarget(creep) {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_SPAWN ||
                structure.structureType == STRUCTURE_EXTENSION) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function isActiveTower(structure) {
    return !structure.isActive || structure.isActive();
}

function findTowerFillTarget(creep, targetEnergy) {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            if(structure.structureType != STRUCTURE_TOWER || !isActiveTower(structure)) {
                return false;
            }

            var desiredEnergy = targetEnergy === undefined ?
                structure.store.getCapacity(RESOURCE_ENERGY) :
                Math.min(targetEnergy, structure.store.getCapacity(RESOURCE_ENERGY));

            return structure.structureType == STRUCTURE_TOWER &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                structure.store[RESOURCE_ENERGY] < desiredEnergy &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function findControllerContainerTarget(creep) {
    if(!creep.room.controller) {
        return null;
    }

    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            return isControllerContainer(structure) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function findStorageTarget(creep) {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_STORAGE &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function findDeliveryTarget(creep) {
    if(creep.room.memory.defenseMode) {
        return findTowerFillTarget(creep) ||
            findSpawnFillTarget(creep) ||
            findControllerContainerTarget(creep) ||
            findStorageTarget(creep);
    }

    return findSpawnFillTarget(creep) ||
        findTowerFillTarget(creep, TOWER_PEACE_REFILL_TARGET) ||
        findControllerContainerTarget(creep) ||
        findStorageTarget(creep);
}

function idleNearBase(creep) {
    var spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(spawn &&
        creep.pos.getRangeTo(spawn) > 3 &&
        creepUtils.canReachBeforeDecay(creep, spawn, 3)) {
        creepUtils.moveTo(creep, spawn, '#66ccff', 'idle', 'move:idle');
        return;
    }

    creepUtils.announceIntent(creep, 'action:idle', 'idle');
}

var roleTransporter = {
    run: function(creep) {
        creepUtils.updateWorkingState(creep, 'deliver', 'haul');

        if(creep.memory.working) {
            var deliveryTarget = findDeliveryTarget(creep);
            if(deliveryTarget) {
                creepUtils.transferEnergy(creep, deliveryTarget);
                return;
            }

            debug.log('debugRoles', creep.name + ' has no delivery target', 10);
            idleNearBase(creep);
            return;
        }

        var sourceEnergy = findSourceEnergy(creep) || findFallbackStoredEnergy(creep);
        if(sourceEnergy) {
            withdrawEnergy(creep, sourceEnergy);
            return;
        }

        if(creepUtils.collectEnergy(creep, {allowHarvest: false, allowStored: false})) {
            return;
        }

        debug.log('debugRoles', creep.name + ' found no container energy to haul', 10);
        idleNearBase(creep);
    }
};

module.exports = roleTransporter;
