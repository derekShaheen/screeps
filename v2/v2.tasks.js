var config = require('v2.config');
var intel = require('v2.intel');
var memory = require('v2.memory');
var utils = require('v2.utils');

function sourceSlotTaskId(sourceId, slot) {
    return sourceId + ':' + slot.x + ':' + slot.y;
}

function getSourceSlotTasks() {
    var tasks = [];
    var sources = intel.getSafeSources();

    for(var i = 0; i < sources.length; i++) {
        for(var s = 0; s < sources[i].slots.length; s++) {
            var slot = sources[i].slots[s];
            tasks.push({
                id: sourceSlotTaskId(sources[i].sourceId, slot),
                type: 'mine',
                roomName: sources[i].roomName,
                sourceId: sources[i].sourceId,
                sourcePos: utils.packPos(sources[i].pos),
                slot: slot,
                pos: utils.unpackPos(slot)
            });
        }
    }

    return tasks;
}

function isTaskStillValid(task) {
    if(!task || !task.id || memory.isRoomHostile(task.roomName)) {
        return false;
    }

    var tasks = getSourceSlotTasks();
    for(var i = 0; i < tasks.length; i++) {
        if(tasks[i].id == task.id) {
            return true;
        }
    }

    return false;
}

function isCreepMiningRole(creep, includeCollectors) {
    return creep.memory.role == config.roles.miner ||
        (includeCollectors &&
            creep.memory.role == config.roles.collector &&
            creep.memory.tempMining === true);
}

function countAssignedMiners(taskId, includeCollectors) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(isCreepMiningRole(creep, includeCollectors) &&
            creep.memory.task &&
            creep.memory.task.id == taskId) {
            count++;
        }
    }

    return count;
}

function isSlotOccupied(task) {
    var pos = task.pos;
    var room = Game.rooms[pos.roomName];
    if(!room) {
        return false;
    }

    var creeps = pos.lookFor(LOOK_CREEPS);
    for(var i = 0; i < creeps.length; i++) {
        if(!creeps[i].spawning) {
            return true;
        }
    }

    return false;
}

function countTemporaryCollectors(taskId) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role == config.roles.collector &&
            creep.memory.tempMining === true &&
            creep.memory.task &&
            creep.memory.task.id == taskId) {
            count++;
        }
    }

    return count;
}

function getTaskSpawnDistance(task) {
    var spawn = utils.getClosestSpawn(task.pos);
    return spawn ? utils.getRange(task.pos, spawn.pos) : 9999;
}

function scoreTaskForCreep(creep, task) {
    return utils.getRange(creep.pos, task.pos) * 2 + getTaskSpawnDistance(task);
}

function assignMiningTask(creep, options) {
    options = options || {};
    var includeCollectors = options.includeCollectors === true;

    if(isTaskStillValid(creep.memory.task) &&
        countAssignedMiners(creep.memory.task.id, includeCollectors) <= 1) {
        return;
    }

    var tasks = getSourceSlotTasks();
    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < tasks.length; i++) {
        if(countAssignedMiners(tasks[i].id, includeCollectors) > 0) {
            continue;
        }

        var score = scoreTaskForCreep(creep, tasks[i]);
        if(score < bestScore) {
            best = tasks[i];
            bestScore = score;
        }
    }

    if(best) {
        creep.memory.task = {
            id: best.id,
            type: best.type,
            roomName: best.roomName,
            sourceId: best.sourceId,
            sourcePos: best.sourcePos,
            slot: best.slot
        };
        if(options.temporary) {
            creep.memory.tempMining = true;
        }
    }
    else {
        delete creep.memory.task;
        delete creep.memory.tempMining;
    }
}

function assignTemporaryMiningTask(creep) {
    if(isTaskStillValid(creep.memory.task) &&
        creep.memory.tempMining === true &&
        countTemporaryCollectors(creep.memory.task.id) <= 1) {
        return;
    }

    var sourceTasks = getSourceSlotTasks();
    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < sourceTasks.length; i++) {
        if(countTemporaryCollectors(sourceTasks[i].id) > 0 ||
            isSlotOccupied(sourceTasks[i])) {
            continue;
        }

        var score = scoreTaskForCreep(creep, sourceTasks[i]);
        if(sourceTasks[i].roomName != creep.room.name) {
            score -= 50;
        }

        if(score < bestScore) {
            best = sourceTasks[i];
            bestScore = score;
        }
    }

    if(best) {
        creep.memory.task = {
            id: best.id,
            type: best.type,
            roomName: best.roomName,
            sourceId: best.sourceId,
            sourcePos: best.sourcePos,
            slot: best.slot
        };
        creep.memory.tempMining = true;
    }
    else {
        delete creep.memory.task;
        delete creep.memory.tempMining;
    }
}

function countRole(role) {
    var count = 0;
    for(var name in Game.creeps) {
        if(Game.creeps[name].memory.role == role) {
            count++;
        }
    }

    return count;
}

function getRoleStats() {
    var stats = {
        miners: 0,
        minersAssigned: 0,
        collectors: 0,
        collectorsFull: 0,
        scouts: 0,
        other: 0
    };

    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role == config.roles.miner) {
            stats.miners++;
            if(creep.memory.task && creep.memory.task.id) {
                stats.minersAssigned++;
            }
        }
        else if(creep.memory.role == config.roles.collector) {
            stats.collectors++;
            if(creep.store && creep.store[RESOURCE_ENERGY] > 0) {
                stats.collectorsFull++;
            }
        }
        else if(creep.memory.role == config.roles.scout) {
            stats.scouts++;
        }
        else {
            stats.other++;
        }
    }

    return stats;
}

function sourceWorkerDemand() {
    return getSourceSlotTasks().length;
}

function desiredMinerCount() {
    return Math.max(config.minMinersPerSpawn * utils.getAllSpawns().length, sourceWorkerDemand());
}

function getCollectableEnergyAmount() {
    var total = 0;
    var rooms = Object.keys(Game.rooms);

    for(var r = 0; r < rooms.length; r++) {
        var room = Game.rooms[rooms[r]];
        if(memory.isRoomHostile(room.name) ||
            intel.roomHasCombatHostiles(room) ||
            intel.roomHasHostileBuildings(room)) {
            continue;
        }

        var dropped = room.find(FIND_DROPPED_RESOURCES, {
            filter: function(resource) {
                return resource.resourceType == RESOURCE_ENERGY;
            }
        });
        for(var i = 0; i < dropped.length; i++) {
            total += dropped[i].amount;
        }

        var containers = room.find(FIND_STRUCTURES, {
            filter: function(structure) {
                return structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store &&
                    structure.store[RESOURCE_ENERGY] > 0;
            }
        });
        for(var c = 0; c < containers.length; c++) {
            total += containers[c].store[RESOURCE_ENERGY];
        }
    }

    return total;
}

function desiredCollectorCount() {
    var miners = countRole(config.roles.miner);
    var baseCollectors = Math.max(utils.getAllSpawns().length, miners);
    var extraCollectors = Math.ceil(Math.max(0, getCollectableEnergyAmount() - baseCollectors * 100) / 300);
    return baseCollectors + extraCollectors;
}

function getCollectableTargetAmount(target) {
    if(!target) {
        return 0;
    }

    if(target.resourceType) {
        return target.amount || 0;
    }

    if(target.store) {
        return target.store[RESOURCE_ENERGY] || 0;
    }

    return 0;
}

function getCollectorReservationMemory() {
    var root = memory.getMemory();
    if(!root.collectorReservations || typeof root.collectorReservations != 'object') {
        root.collectorReservations = {};
    }

    return root.collectorReservations;
}

function cleanupCollectorReservations() {
    var reservations = getCollectorReservationMemory();
    for(var targetId in reservations) {
        for(var creepName in reservations[targetId]) {
            var creep = Game.creeps[creepName];
            if(!creep ||
                creep.memory.role != config.roles.collector ||
                creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                delete reservations[targetId][creepName];
            }
        }
    }
}

function getReservedCollectAmount(targetId) {
    var reservations = getCollectorReservationMemory();
    if(!reservations[targetId]) {
        return 0;
    }

    var total = 0;
    for(var creepName in reservations[targetId]) {
        total += reservations[targetId][creepName];
    }

    return total;
}

function reserveCollectTarget(creep, target) {
    if(!target || !target.id) {
        return false;
    }

    var available = getCollectableTargetAmount(target) - getReservedCollectAmount(target.id);
    if(available <= 0) {
        return false;
    }

    var amount = Math.min(creep.store.getFreeCapacity(RESOURCE_ENERGY), available);
    if(amount <= 0) {
        return false;
    }

    var reservations = getCollectorReservationMemory();
    if(!reservations[target.id]) {
        reservations[target.id] = {};
    }
    reservations[target.id][creep.name] = amount;
    creep.memory.collectTargetId = target.id;
    return true;
}

function releaseCollectReservation(creep) {
    if(!creep.memory.collectTargetId) {
        return;
    }

    var reservations = getCollectorReservationMemory();
    if(reservations[creep.memory.collectTargetId]) {
        delete reservations[creep.memory.collectTargetId][creep.name];
    }
    delete creep.memory.collectTargetId;
}

function findReservedEnergyPickup(creep) {
    if(!creep.memory.collectTargetId) {
        return null;
    }

    var target = Game.getObjectById(creep.memory.collectTargetId);
    if(!target || getCollectableTargetAmount(target) <= 0) {
        releaseCollectReservation(creep);
        return null;
    }

    return target;
}

function findEnergyPickup(creep) {
    cleanupCollectorReservations();

    var reserved = findReservedEnergyPickup(creep);
    if(reserved) {
        return reserved;
    }

    var rooms = Object.keys(Game.rooms);
    var best = null;
    var bestScore = 999999;

    for(var r = 0; r < rooms.length; r++) {
        var room = Game.rooms[rooms[r]];
        if(memory.isRoomHostile(room.name) ||
            intel.roomHasCombatHostiles(room) ||
            intel.roomHasHostileBuildings(room)) {
            continue;
        }

        var dropped = room.find(FIND_DROPPED_RESOURCES, {
            filter: function(resource) {
                return resource.resourceType == RESOURCE_ENERGY && resource.amount >= 25;
            }
        });

        for(var i = 0; i < dropped.length; i++) {
            var available = dropped[i].amount - getReservedCollectAmount(dropped[i].id);
            if(available <= 0) {
                continue;
            }

            var score = utils.getRange(creep.pos, dropped[i].pos) - available / 25;
            if(score < bestScore) {
                best = dropped[i];
                bestScore = score;
            }
        }

        var containers = room.find(FIND_STRUCTURES, {
            filter: function(structure) {
                return structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store &&
                    structure.store[RESOURCE_ENERGY] >= 50;
            }
        });

        for(var c = 0; c < containers.length; c++) {
            var containerAvailable = containers[c].store[RESOURCE_ENERGY] - getReservedCollectAmount(containers[c].id);
            if(containerAvailable <= 0) {
                continue;
            }

            var containerScore = utils.getRange(creep.pos, containers[c].pos) - containerAvailable / 50;
            if(containerScore < bestScore) {
                best = containers[c];
                bestScore = containerScore;
            }
        }
    }

    return reserveCollectTarget(creep, best) ? best : null;
}

function pickupEnergy(creep, target, movement) {
    if(!target) {
        return false;
    }

    if(target.resourceType) {
        var pickupResult = creep.pickup(target);
        if(pickupResult == ERR_NOT_IN_RANGE) {
            movement.moveTo(creep, target, 1);
        }
        else if(pickupResult == OK) {
            releaseCollectReservation(creep);
        }
        return true;
    }

    var withdrawResult = creep.withdraw(target, RESOURCE_ENERGY);
    if(withdrawResult == ERR_NOT_IN_RANGE) {
        movement.moveTo(creep, target, 1);
    }
    else if(withdrawResult == OK) {
        releaseCollectReservation(creep);
    }
    return true;
}

function findEnergyDeliveryTarget(creep) {
    var rooms = utils.getOwnedRoomsWithSpawns();
    var best = null;
    var bestScore = 999999;

    function consider(target) {
        var score = utils.getRange(creep.pos, target.pos);
        if(score < bestScore) {
            best = target;
            bestScore = score;
        }
    }

    for(var r = 0; r < rooms.length; r++) {
        var fills = rooms[r].find(FIND_MY_STRUCTURES, {
            filter: function(structure) {
                return (structure.structureType == STRUCTURE_SPAWN ||
                    structure.structureType == STRUCTURE_EXTENSION) &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });
        for(var i = 0; i < fills.length; i++) {
            consider(fills[i]);
        }
    }

    return best;
}

function findBuildTarget(creep) {
    var rooms = utils.getOwnedRoomsWithSpawns();
    var best = null;
    var bestScore = 999999;

    for(var r = 0; r < rooms.length; r++) {
        var sites = rooms[r].find(FIND_MY_CONSTRUCTION_SITES);
        for(var i = 0; i < sites.length; i++) {
            var typeBonus = sites[i].structureType == STRUCTURE_EXTENSION ? -50 :
                sites[i].structureType == STRUCTURE_ROAD ? -35 :
                0;
            var score = utils.getRange(creep.pos, sites[i].pos) + typeBonus;
            if(score < bestScore) {
                best = sites[i];
                bestScore = score;
            }
        }
    }

    return best;
}

module.exports = {
    getSourceSlotTasks: getSourceSlotTasks,
    assignMiningTask: assignMiningTask,
    assignTemporaryMiningTask: assignTemporaryMiningTask,
    countAssignedMiners: countAssignedMiners,
    getTaskSpawnDistance: getTaskSpawnDistance,
    scoreTaskForCreep: scoreTaskForCreep,
    countRole: countRole,
    getRoleStats: getRoleStats,
    sourceWorkerDemand: sourceWorkerDemand,
    desiredMinerCount: desiredMinerCount,
    desiredCollectorCount: desiredCollectorCount,
    getCollectableEnergyAmount: getCollectableEnergyAmount,
    releaseCollectReservation: releaseCollectReservation,
    findEnergyPickup: findEnergyPickup,
    pickupEnergy: pickupEnergy,
    findEnergyDeliveryTarget: findEnergyDeliveryTarget,
    findBuildTarget: findBuildTarget
};
