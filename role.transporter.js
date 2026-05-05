var creepUtils = require('utils.creep');
var debug = require('utils.debug');
var labManager = require('manager.lab');
var remoteManager = require('manager.remote');

var TOWER_PEACE_REFILL_TARGET = 600;
var TERMINAL_ENERGY_TARGET = 5000;

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

            if(structure.structureType == STRUCTURE_LINK) {
                var linkRole = creepUtils.getLinkRole(creep.room, structure);
                if(linkRole == 'source' || linkRole == 'controller') {
                    return false;
                }
            }

            return (structure.structureType == STRUCTURE_CONTAINER ||
                structure.structureType == STRUCTURE_STORAGE ||
                structure.structureType == STRUCTURE_LINK) &&
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

function getCarriedNonEnergy(creep) {
    for(var resourceType in creep.store) {
        if(resourceType != RESOURCE_ENERGY && creep.store[resourceType] > 0) {
            return resourceType;
        }
    }

    return null;
}

function withdrawResource(creep, task) {
    var source = Game.getObjectById(task.sourceId);
    var target = Game.getObjectById(task.targetId);
    if(!source || !target || !source.store || !target.store) {
        delete creep.memory.labLogisticsTargetId;
        delete creep.memory.labLogisticsResourceType;
        return false;
    }

    var amount = Math.min(
        task.amount || creep.store.getFreeCapacity(),
        creep.store.getFreeCapacity(),
        source.store[task.resourceType] || 0,
        target.store.getFreeCapacity(task.resourceType)
    );
    if(amount <= 0) {
        delete creep.memory.labLogisticsTargetId;
        delete creep.memory.labLogisticsResourceType;
        return false;
    }

    var result = creep.withdraw(source, task.resourceType, amount);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, source, '#cc66ff', task.label || 'lab', 'move:labResource');
        return true;
    }

    if(result == OK) {
        creep.memory.labLogisticsTargetId = task.targetId;
        creep.memory.labLogisticsResourceType = task.resourceType;
        creepUtils.announceIntent(creep, 'action:labWithdraw', task.label || 'lab');
        debug.log(
            'debugRoles',
            creep.name + ' withdrew ' + task.resourceType + ' for ' +
                (task.label || 'lab') + ' at ' + formatPos(source.pos),
            5
        );
        return true;
    }

    debug.log('debugRoles', creep.name + ' lab withdraw failed: ' + result, 5);
    return false;
}

function transferResource(creep, target, resourceType) {
    if(!target || !target.store) {
        delete creep.memory.labLogisticsTargetId;
        delete creep.memory.labLogisticsResourceType;
        return false;
    }

    var result = creep.transfer(target, resourceType);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#cc66ff', 'go lab', 'move:labResource');
        return true;
    }

    if(result == OK) {
        delete creep.memory.labLogisticsTargetId;
        delete creep.memory.labLogisticsResourceType;
        creepUtils.announceIntent(creep, 'action:labTransfer', 'lab');
        debug.log(
            'debugRoles',
            creep.name + ' delivered ' + resourceType + ' to ' +
                target.structureType + ' at ' + formatPos(target.pos),
            5
        );
        return true;
    }

    if(result == ERR_FULL || result == ERR_INVALID_TARGET) {
        delete creep.memory.labLogisticsTargetId;
        delete creep.memory.labLogisticsResourceType;
    }

    debug.log('debugRoles', creep.name + ' lab transfer failed: ' + result, 5);
    return false;
}

function runLabLogistics(creep) {
    if(creep.memory.remoteHauling) {
        return false;
    }

    var carried = getCarriedNonEnergy(creep);
    if(carried) {
        var target = labManager.getDeliveryTarget(creep, carried);
        if(target) {
            return transferResource(creep, target, carried);
        }

        debug.log('debugRoles', creep.name + ' has no non-energy delivery target for ' + carried, 10);
        idleNearBase(creep);
        return true;
    }

    if(findSpawnFillTarget(creep) || findTowerFillTarget(creep, TOWER_PEACE_REFILL_TARGET)) {
        return false;
    }

    if(creep.store.getUsedCapacity() > 0 || creep.store.getFreeCapacity() <= 0) {
        return false;
    }

    var task = labManager.getLogisticsTask(creep);
    if(task) {
        return withdrawResource(creep, task);
    }

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

function findTerminalTarget(creep) {
    var targetEnergy = creep.room.memory.terminalEnergyTarget || TERMINAL_ENERGY_TARGET;
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TERMINAL &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                structure.store[RESOURCE_ENERGY] < targetEnergy &&
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
            findTerminalTarget(creep) ||
            findStorageTarget(creep);
    }

    return findSpawnFillTarget(creep) ||
        findTowerFillTarget(creep, TOWER_PEACE_REFILL_TARGET) ||
        findControllerContainerTarget(creep) ||
        findTerminalTarget(creep) ||
        findStorageTarget(creep);
}

function idleNearBase(creep) {
    var spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(spawn &&
        creep.pos.getRangeTo(spawn) > 8 &&
        creepUtils.canReachBeforeDecay(creep, spawn, 3)) {
        creepUtils.moveTo(creep, spawn, '#66ccff', 'idle', 'move:idle');
        return;
    }

    creepUtils.announceIntent(creep, 'action:idle', 'idle');
}

var roleTransporter = {
    run: function(creep) {
        if(creep.memory.remoteHauling &&
            (remoteManager.hasThreats(creep.room) ||
            (creep.room.name == creep.memory.targetRoom && remoteManager.hasHostileTower(creep.room)))) {
            if(creep.room.name == creep.memory.targetRoom) {
                remoteManager.markUnsafe(creep.memory.homeRoom || creep.room.name, creep.memory.targetRoom || creep.room.name, 'remote unsafe');
            }
            return remoteManager.moveHome(creep, 'retreat');
        }

        if(runLabLogistics(creep)) {
            return;
        }

        creepUtils.updateWorkingState(creep, 'deliver', 'haul');

        if(creep.memory.working) {
            if(creep.memory.remoteHauling) {
                if(remoteManager.deliverHome(creep)) {
                    return;
                }

                delete creep.memory.remoteHauling;
            }

            var deliveryTarget = findDeliveryTarget(creep);
            if(deliveryTarget) {
                creepUtils.transferEnergy(creep, deliveryTarget);
                return;
            }

            debug.log('debugRoles', creep.name + ' has no delivery target', 10);
            idleNearBase(creep);
            return;
        }

        if(creepUtils.collectEnergy(creep, {allowHarvest: false, allowStored: false, quietNoEnergy: true})) {
            return;
        }

        var sourceEnergy = findSourceEnergy(creep) || findFallbackStoredEnergy(creep);
        if(sourceEnergy) {
            delete creep.memory.remoteHauling;
            withdrawEnergy(creep, sourceEnergy);
            return;
        }

        var remoteEnergy = remoteManager.findRemoteEnergyTarget(creep, creep.room.name);
        if(remoteEnergy) {
            creep.memory.remoteHauling = true;
            creep.memory.homeRoom = creep.room.name;
            creep.memory.targetRoom = remoteEnergy.pos.roomName;
            remoteManager.withdrawOrPickup(creep, remoteEnergy);
            return;
        }

        debug.log('debugRoles', creep.name + ' found no container energy to haul', 10);
        idleNearBase(creep);
    }
};

module.exports = roleTransporter;
