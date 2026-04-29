var creepUtils = require('utils.creep');
var debug = require('utils.debug');

function findFillTarget(creep) {
    var spawnOrExtension = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_SPAWN ||
                structure.structureType == STRUCTURE_EXTENSION) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    if(spawnOrExtension) {
        return spawnOrExtension;
    }

    var tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
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

            return structure.structureType == STRUCTURE_STORAGE ||
                structure.structureType == STRUCTURE_CONTAINER;
        }
    });
}

var roleHarvester = {
    run: function(creep) {
        creepUtils.updateWorkingState(creep, 'deliver', 'harvest');

        if(!creep.memory.working) {
            creepUtils.collectEnergy(creep, {preferHarvest: true});
            return;
        }

        var target = findFillTarget(creep);
        if(target) {
            creepUtils.transferEnergy(creep, target);
            return;
        }

        debug.log('debugRoles', creep.name + ' found no energy target; upgrading instead', 5);
        creepUtils.upgrade(creep);
    }
};

module.exports = roleHarvester;
