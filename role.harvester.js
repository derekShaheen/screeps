var creepUtils = require('utils.creep');
var debug = require('utils.debug');

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function roomHasTransporter(room) {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.room.name == room.name && creep.memory.role == 'transporter' && !creep.spawning) {
            return true;
        }
    }

    return false;
}

function findSpawnOrExtensionTarget(creep) {
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

function findFillTarget(creep) {
    var spawnOrExtension = findSpawnOrExtensionTarget(creep);

    if(spawnOrExtension) {
        return spawnOrExtension;
    }

    var tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });

    if(tower) {
        return tower;
    }

    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            if(!structure.store || structure.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
                return false;
            }

            return (structure.structureType == STRUCTURE_STORAGE ||
                structure.structureType == STRUCTURE_CONTAINER) &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 1);
        }
    });
}

function countAssignedHarvesters(room, sourceId, selfName) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.name == selfName) {
            continue;
        }

        if(creep.room.name == room.name &&
            creep.memory.role == 'harvester' &&
            creep.memory.harvestSourceId == sourceId) {
            count++;
        }
    }

    return count;
}

function countContainerMiners(room, sourceId, selfName) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.name == selfName) {
            continue;
        }

        if(creep.room.name == room.name &&
            creep.memory.role == 'harvester' &&
            creep.memory.containerSourceId == sourceId &&
            !creep.spawning) {
            count++;
        }
    }

    return count;
}

function getSourceContainer(source) {
    var containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER;
        }
    });

    containers.sort(function(a, b) {
        return b.store.getFreeCapacity(RESOURCE_ENERGY) - a.store.getFreeCapacity(RESOURCE_ENERGY);
    });

    return containers[0] || null;
}

function sourceHasUsableContainer(creep, source) {
    var container = getSourceContainer(source);
    return container &&
        creepUtils.isSafeTarget(creep, container) &&
        creepUtils.canReachBeforeDecay(creep, source, 1) &&
        creepUtils.canReachBeforeDecay(creep, container, 0);
}

function chooseContainerSource(creep) {
    if(creep.memory.containerSourceId) {
        var remembered = Game.getObjectById(creep.memory.containerSourceId);
        if(remembered &&
            remembered.room.name == creep.room.name &&
            creepUtils.isSafeTarget(creep, remembered) &&
            creepUtils.canReachBeforeDecay(creep, remembered, 1) &&
            sourceHasUsableContainer(creep, remembered) &&
            countContainerMiners(creep.room, remembered.id, creep.name) === 0) {
            return remembered;
        }

        delete creep.memory.containerSourceId;
    }

    var sources = creep.room.find(FIND_SOURCES, {
        filter: function(source) {
            return creepUtils.isSafeTarget(creep, source) &&
                creepUtils.canReachBeforeDecay(creep, source, 1) &&
                sourceHasUsableContainer(creep, source) &&
                countContainerMiners(creep.room, source.id, creep.name) === 0;
        }
    });

    if(!sources.length) {
        return null;
    }

    sources.sort(function(a, b) {
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    creep.memory.containerSourceId = sources[0].id;
    creep.memory.harvestSourceId = sources[0].id;
    return sources[0];
}

function chooseHarvestSource(creep) {
    if(creep.memory.harvestSourceId) {
        var remembered = Game.getObjectById(creep.memory.harvestSourceId);
        if(remembered &&
            remembered.room.name == creep.room.name &&
            creepUtils.isSafeTarget(creep, remembered) &&
            creepUtils.canReachBeforeDecay(creep, remembered, 1)) {
            return remembered;
        }
    }

    var sources = creep.room.find(FIND_SOURCES, {
        filter: function(source) {
            return creepUtils.isSafeTarget(creep, source) &&
                creepUtils.canReachBeforeDecay(creep, source, 1);
        }
    });

    if(!sources.length) {
        return null;
    }

    sources.sort(function(a, b) {
        var assignmentDiff = countAssignedHarvesters(creep.room, a.id, creep.name) -
            countAssignedHarvesters(creep.room, b.id, creep.name);
        if(assignmentDiff !== 0) {
            return assignmentDiff;
        }

        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    creep.memory.harvestSourceId = sources[0].id;
    return sources[0];
}

function isContainerOccupiedByOther(creep, container) {
    var creeps = container.pos.lookFor(LOOK_CREEPS);
    for(var i = 0; i < creeps.length; i++) {
        if(creeps[i].name != creep.name) {
            return true;
        }
    }

    return false;
}

function harvestToContainer(creep, source, container) {
    if(!creepUtils.canReachBeforeDecay(creep, source, 1) ||
        !creepUtils.canReachBeforeDecay(creep, container, 0)) {
        debug.log('debugRoles', creep.name + ' skipped source container that will decay before arrival', 5);
        return false;
    }

    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        debug.log(
            'debugRoles',
            creep.name + ' source container is full; delivering instead of waiting at ' + formatPos(container.pos),
            5
        );
        return false;
    }

    var shouldDeposit = creep.store[RESOURCE_ENERGY] > 0 &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 || source.energy === 0);

    if(shouldDeposit) {
        var transferResult = creep.transfer(container, RESOURCE_ENERGY);
        if(transferResult == ERR_NOT_IN_RANGE) {
            creepUtils.moveTo(creep, container, '#ffaa00', 'dropoff', 'move:containerDropoff');
            return true;
        }

        if(transferResult == OK) {
            creepUtils.announceIntent(creep, 'action:containerFill', 'fill box');
            debug.log('debugRoles', creep.name + ' filled source container at ' + formatPos(container.pos), 3);
            return true;
        }
    }

    if(!creep.pos.inRangeTo(source, 1)) {
        creepUtils.moveTo(creep, container, '#ffaa00', 'go mine', 'move:containerMine');
        return true;
    }

    if(!creep.pos.isEqualTo(container.pos) && !isContainerOccupiedByOther(creep, container)) {
        creepUtils.moveTo(creep, container, '#ffaa00', 'mine box', 'move:containerMine');
        return true;
    }

    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        debug.log('debugRoles', creep.name + ' waiting because source container is full at ' + formatPos(container.pos), 5);
        creepUtils.announceIntent(creep, 'action:containerFull', 'box full');
        return true;
    }

    var harvestResult = creep.harvest(source);
    if(harvestResult == OK) {
        creepUtils.announceIntent(creep, 'action:containerHarvest', 'mine');
        return true;
    }

    if(harvestResult == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, container, '#ffaa00', 'go mine', 'move:containerMine');
        return true;
    }

    debug.log('debugRoles', creep.name + ' container harvest failed: ' + harvestResult, 5);
    return false;
}

function runContainerHarvesting(creep) {
    if(!roomHasTransporter(creep.room) && findSpawnOrExtensionTarget(creep)) {
        delete creep.memory.containerSourceId;
        return false;
    }

    var source = chooseContainerSource(creep);
    if(!source) {
        return false;
    }

    var container = getSourceContainer(source);
    if(!container ||
        !creepUtils.isSafeTarget(creep, container) ||
        !creepUtils.canReachBeforeDecay(creep, container, 0)) {
        delete creep.memory.containerSourceId;
        return false;
    }

    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 && creep.pos.getRangeTo(container) > 1) {
        debug.log(
            'debugRoles',
            creep.name + ' is full away from its source container; delivering instead',
            5
        );
        return false;
    }

    creepUtils.releaseEnergyQueue(creep);
    return harvestToContainer(creep, source, container);
}

function runDelivery(creep) {
    var target = findFillTarget(creep);
    if(target) {
        creepUtils.transferEnergy(creep, target);
        return;
    }

    debug.log('debugRoles', creep.name + ' found no energy target; upgrading instead', 5);
    creepUtils.upgrade(creep);
}

var roleHarvester = {
    run: function(creep) {
        if(runContainerHarvesting(creep)) {
            return;
        }

        creepUtils.updateWorkingState(creep, 'deliver', 'harvest');

        if(!creep.memory.working) {
            creepUtils.collectEnergy(creep, {preferHarvest: true});
            return;
        }

        runDelivery(creep);
    }
};

module.exports = roleHarvester;
