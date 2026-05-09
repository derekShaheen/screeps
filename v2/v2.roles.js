var config = require('v2.config');
var intel = require('v2.intel');
var memory = require('v2.memory');
var tasks = require('v2.tasks');
var utils = require('v2.utils');

function findSourceContainer(source) {
    var containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER;
        }
    });

    containers.sort(function(a, b) {
        return a.pos.getRangeTo(source.pos) - b.pos.getRangeTo(source.pos);
    });

    return containers[0] || null;
}

function findSourceContainerSite(source) {
    var sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: function(site) {
            return site.structureType == STRUCTURE_CONTAINER && site.my !== false;
        }
    });

    sites.sort(function(a, b) {
        return a.pos.getRangeTo(source.pos) - b.pos.getRangeTo(source.pos);
    });

    return sites[0] || null;
}

function canPlaceContainerSite(room, pos) {
    if(!pos ||
        pos.roomName != room.name ||
        pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49 ||
        room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    if(pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType != STRUCTURE_ROAD &&
            structures[i].structureType != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return true;
}

function createSourceContainerSite(creep, source) {
    var preferred = creep.memory.task && creep.memory.task.slot ?
        utils.unpackPos(creep.memory.task.slot) :
        null;

    if(preferred &&
        preferred.roomName == source.room.name &&
        preferred.getRangeTo(source.pos) <= 1 &&
        canPlaceContainerSite(source.room, preferred) &&
        preferred.createConstructionSite(STRUCTURE_CONTAINER) == OK) {
        return Game.rooms[preferred.roomName].lookForAt(LOOK_CONSTRUCTION_SITES, preferred.x, preferred.y)[0] || null;
    }

    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var pos = new RoomPosition(source.pos.x + dx, source.pos.y + dy, source.room.name);
            if(canPlaceContainerSite(source.room, pos) &&
                pos.createConstructionSite(STRUCTURE_CONTAINER) == OK) {
                return Game.rooms[pos.roomName].lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y)[0] || null;
            }
        }
    }

    return null;
}

function buildSourceContainer(creep, source, movement) {
    if(findSourceContainer(source)) {
        return false;
    }

    var site = findSourceContainerSite(source) || createSourceContainerSite(creep, source);
    if(!site) {
        return false;
    }

    var buildResult = creep.build(site);
    if(buildResult == ERR_NOT_IN_RANGE) {
        movement.moveTo(creep, site, 3);
        return true;
    }

    return buildResult == OK;
}

function deliverEnergy(creep, movement) {
    var fill = tasks.findEnergyDeliveryTarget(creep);
    if(fill) {
        var transferResult = creep.transfer(fill, RESOURCE_ENERGY);
        if(transferResult == ERR_NOT_IN_RANGE) {
            movement.moveTo(creep, fill, 1);
        }
        return true;
    }

    if(shouldCollectorUpgrade(creep) && upgradeController(creep, movement)) {
        return true;
    }

    var build = tasks.findBuildTarget(creep);
    if(build) {
        var buildResult = creep.build(build);
        if(buildResult == ERR_NOT_IN_RANGE) {
            movement.moveTo(creep, build, 3);
        }
        return true;
    }

    return upgradeController(creep, movement);
}

function upgradeController(creep, movement) {
    var controller = utils.getClosestOwnedController(creep.pos);
    if(controller) {
        var upgradeResult = creep.upgradeController(controller);
        if(upgradeResult == ERR_NOT_IN_RANGE) {
            movement.moveTo(creep, controller, 3);
        }
        return true;
    }

    return false;
}

function getCollectorNames() {
    var names = [];
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(!creep.spawning && creep.memory.role == config.roles.collector) {
            names.push(name);
        }
    }

    names.sort();
    return names;
}

function shouldCollectorUpgrade(creep) {
    var ratio = typeof config.collectorUpgradeRatio == 'number' ?
        config.collectorUpgradeRatio :
        0.25;
    if(ratio <= 0) {
        return false;
    }

    var names = getCollectorNames();
    if(names.length <= 1) {
        return false;
    }

    var upgraderCount = Math.max(1, Math.ceil(names.length * Math.min(ratio, 1)));
    return names.indexOf(creep.name) >= 0 && names.indexOf(creep.name) < upgraderCount;
}

function fillSpawnEnergy(creep, movement) {
    var fill = tasks.findEnergyDeliveryTarget(creep);
    if(!fill) {
        return false;
    }

    var transferResult = creep.transfer(fill, RESOURCE_ENERGY);
    if(transferResult == ERR_NOT_IN_RANGE) {
        movement.moveTo(creep, fill, 1);
    }

    return true;
}

function dumpMinerEnergy(creep, source, movement) {
    var container = source ? findSourceContainer(source) : null;
    if(container && container.store && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        var transferResult = creep.transfer(container, RESOURCE_ENERGY);
        if(transferResult == ERR_NOT_IN_RANGE) {
            movement.moveTo(creep, container, 1);
        }
        return true;
    }

    creep.drop(RESOURCE_ENERGY);
    return true;
}

function shouldMinerSelfHaul() {
    return tasks.countRole(config.roles.collector) === 0;
}

function shouldBootstrapHaulToSpawn() {
    return tasks.countRole(config.roles.collector) < tasks.desiredCollectorCount();
}

function assignFallbackScoutTarget(creep) {
    if(creep.memory.fallbackScoutRoom) {
        return creep.memory.fallbackScoutRoom;
    }

    var targets = intel.getUnknownScoutTargets();
    var best = null;
    var bestScore = 999999;
    for(var i = 0; i < targets.length; i++) {
        var score = utils.getRange(creep.pos, utils.roomCenter(targets[i]));
        if(score < bestScore) {
            best = targets[i];
            bestScore = score;
        }
    }

    creep.memory.fallbackScoutRoom = best;
    return best;
}

function runMiner(creep, movement) {
    if(intel.retreatIfDanger(creep, movement)) {
        return;
    }

    tasks.assignMiningTask(creep);
    delete creep.memory.tempMining;
    if(!creep.memory.task) {
        var scoutRoom = assignFallbackScoutTarget(creep);
        if(scoutRoom) {
            movement.moveTo(creep, utils.roomCenter(scoutRoom), 20);
            return;
        }

        var spawn = utils.getClosestSpawn(creep.pos);
        if(spawn) {
            movement.moveTo(creep, spawn, 4);
        }
        return;
    }

    delete creep.memory.fallbackScoutRoom;
    var slotPos = utils.unpackPos(creep.memory.task.slot);
    var source = Game.getObjectById(creep.memory.task.sourceId);

    if(!source) {
        if(creep.store[RESOURCE_ENERGY] > 0) {
            deliverEnergy(creep, movement);
            return;
        }

        if(creep.pos.roomName != slotPos.roomName || !creep.pos.isEqualTo(slotPos)) {
            movement.moveTo(creep, slotPos, 0);
        }
        return;
    }

    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        if(shouldBootstrapHaulToSpawn() && fillSpawnEnergy(creep, movement)) {
            return;
        }

        if(buildSourceContainer(creep, source, movement)) {
            return;
        }

        if(shouldMinerSelfHaul()) {
            deliverEnergy(creep, movement);
            return;
        }

        dumpMinerEnergy(creep, source, movement);
        return;
    }

    if(creep.pos.roomName != slotPos.roomName || !creep.pos.isEqualTo(slotPos)) {
        movement.moveTo(creep, slotPos, 0);
        return;
    }

    var harvestResult = creep.harvest(source);
    if(harvestResult == ERR_NOT_IN_RANGE) {
        movement.moveTo(creep, source, 1);
    }
    else if(harvestResult == OK &&
        creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 &&
        !shouldMinerSelfHaul()) {
        dumpMinerEnergy(creep, source, movement);
    }
}

function runTemporaryCollectorMining(creep, movement) {
    tasks.assignTemporaryMiningTask(creep);
    if(!creep.memory.task) {
        return false;
    }

    var slotPos = utils.unpackPos(creep.memory.task.slot);
    var source = Game.getObjectById(creep.memory.task.sourceId);
    if(!source) {
        if(creep.pos.roomName != slotPos.roomName || !creep.pos.isEqualTo(slotPos)) {
            movement.moveTo(creep, slotPos, 0);
            return true;
        }
        return false;
    }

    if(creep.pos.roomName != slotPos.roomName || !creep.pos.isEqualTo(slotPos)) {
        movement.moveTo(creep, slotPos, 0);
        return true;
    }

    var harvestResult = creep.harvest(source);
    if(harvestResult == ERR_NOT_IN_RANGE) {
        movement.moveTo(creep, source, 1);
    }
    return true;
}

function runCollector(creep, movement) {
    if(intel.retreatIfDanger(creep, movement)) {
        return;
    }

    if(creep.store[RESOURCE_ENERGY] > 0) {
        tasks.releaseCollectReservation(creep);
        deliverEnergy(creep, movement);
        return;
    }

    var pickup = tasks.findEnergyPickup(creep);
    if(pickup) {
        tasks.pickupEnergy(creep, pickup, movement);
        return;
    }

    if(runTemporaryCollectorMining(creep, movement)) {
        return;
    }

    var build = tasks.findBuildTarget(creep);
    if(build) {
        movement.moveTo(creep, build, 3);
        return;
    }

    var spawn = utils.getClosestSpawn(creep.pos);
    if(spawn) {
        movement.moveTo(creep, spawn, 3);
    }
}

function assignScoutTarget(creep) {
    if(creep.memory.targetRoom && !memory.isRoomHostile(creep.memory.targetRoom)) {
        return;
    }

    var targets = intel.getUnknownScoutTargets();
    var best = null;
    var bestScore = 999999;
    for(var i = 0; i < targets.length; i++) {
        var score = utils.getRange(creep.pos, utils.roomCenter(targets[i]));
        if(score < bestScore) {
            best = targets[i];
            bestScore = score;
        }
    }

    creep.memory.targetRoom = best;
}

function runScout(creep, movement) {
    if(intel.retreatIfDanger(creep, movement)) {
        delete creep.memory.targetRoom;
        return;
    }

    assignScoutTarget(creep);
    if(!creep.memory.targetRoom) {
        var spawn = utils.getClosestSpawn(creep.pos);
        if(spawn) {
            movement.moveTo(creep, spawn, 3);
        }
        return;
    }

    if(creep.room.name != creep.memory.targetRoom) {
        movement.moveTo(creep, utils.roomCenter(creep.memory.targetRoom), 20);
        return;
    }

    var controller = creep.room.controller;
    if(controller && creep.pos.getRangeTo(controller) > 4) {
        movement.moveTo(creep, controller, 4);
    }
}

function runCreep(creep, movement) {
    movement.recordActualMovement(creep);
    movement.recordRoadUsage(creep);

    if(creep.memory.role == config.roles.scout) {
        runScout(creep, movement);
    }
    else if(creep.memory.role == config.roles.collector) {
        runCollector(creep, movement);
    }
    else {
        creep.memory.role = config.roles.miner;
        runMiner(creep, movement);
    }
}

function runAll(movement) {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(!creep.spawning) {
            runCreep(creep, movement);
        }
    }
}

module.exports = {
    runAll: runAll
};
