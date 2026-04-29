var debug = require('utils.debug');

function moveTo(creep, target, stroke) {
    var options = {
        reusePath: 5
    };

    if(debug.enabled('debugVisuals') && debug.enabled('debugPaths')) {
        options.visualizePathStyle = {
            stroke: stroke || '#ffffff',
            opacity: 0.55,
            strokeWidth: 0.12,
            lineStyle: 'dashed'
        };
    }

    return creep.moveTo(target, options);
}

function setWorking(creep, working, label) {
    if(creep.memory.working !== working) {
        creep.memory.working = working;
        debug.roleState(creep, working ? 'working' : 'gathering');
        if(label) {
            creep.say(label);
        }
    }
}

function updateWorkingState(creep, workingLabel, gatheringLabel) {
    if(creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        setWorking(creep, false, gatheringLabel || 'energy');
    }

    if(!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        setWorking(creep, true, workingLabel || 'work');
    }

    if(creep.memory.working === undefined) {
        creep.memory.working = false;
    }

    return creep.memory.working;
}

function findNearestSource(creep) {
    return creep.pos.findClosestByPath(FIND_SOURCES);
}

function findNearestActiveSource(creep) {
    return creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
}

function withdrawFromTarget(creep, target) {
    var result = creep.withdraw(target, RESOURCE_ENERGY);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffaa00');
        return true;
    }

    return result == OK;
}

function pickupTarget(creep, target) {
    var result = creep.pickup(target);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffaa00');
        return true;
    }

    return result == OK;
}

function rememberHarvestPosition(creep, source) {
    creep.memory.lastHarvestPosition = {
        x: creep.pos.x,
        y: creep.pos.y,
        roomName: creep.pos.roomName,
        sourceX: source.pos.x,
        sourceY: source.pos.y,
        sourceRoomName: source.pos.roomName
    };
}

function harvestTarget(creep, target) {
    var result = creep.harvest(target);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffaa00');
        return true;
    }

    if(result == OK) {
        rememberHarvestPosition(creep, target);
        return true;
    }

    return result == OK;
}

function findStoredEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            if(!structure.store || structure.store[RESOURCE_ENERGY] <= 0) {
                return false;
            }

            return structure.structureType == STRUCTURE_CONTAINER ||
                structure.structureType == STRUCTURE_STORAGE;
        }
    });
}

function findDroppedEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: function(resource) {
            return resource.resourceType == RESOURCE_ENERGY && resource.amount > 0;
        }
    });
}

function findTombstoneEnergy(creep) {
    if(typeof FIND_TOMBSTONES === 'undefined') {
        return null;
    }

    return creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: function(tombstone) {
            return tombstone.store && tombstone.store[RESOURCE_ENERGY] > 0;
        }
    });
}

function collectEnergy(creep, options) {
    options = options || {};

    if(creep.store.getFreeCapacity() === 0) {
        return true;
    }

    if(options.preferHarvest) {
        var harvestSource = findNearestActiveSource(creep);
        if(harvestSource) {
            return harvestTarget(creep, harvestSource);
        }
    }

    var tombstone = findTombstoneEnergy(creep);
    if(tombstone) {
        return withdrawFromTarget(creep, tombstone);
    }

    var storedEnergy = findStoredEnergy(creep);
    if(storedEnergy) {
        return withdrawFromTarget(creep, storedEnergy);
    }

    var droppedEnergy = findDroppedEnergy(creep);
    if(droppedEnergy) {
        return pickupTarget(creep, droppedEnergy);
    }

    var source = findNearestSource(creep);
    if(source) {
        return harvestTarget(creep, source);
    }

    debug.log('debugRoles', creep.name + ' has no energy source in ' + creep.room.name, 5);
    return false;
}

function transferEnergy(creep, target) {
    var result = creep.transfer(target, RESOURCE_ENERGY);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffffff');
        return true;
    }

    return result == OK;
}

function upgrade(creep) {
    if(!creep.room.controller) {
        return false;
    }

    var result = creep.upgradeController(creep.room.controller);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, creep.room.controller, '#ffffff');
        return true;
    }

    return result == OK;
}

module.exports = {
    collectEnergy: collectEnergy,
    moveTo: moveTo,
    transferEnergy: transferEnergy,
    updateWorkingState: updateWorkingState,
    upgrade: upgrade
};
