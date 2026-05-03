var creepUtils = require('utils.creep');
var debug = require('utils.debug');

var DEFAULT_SETTINGS = {
    enabled: true,
    maxRooms: 2,
    minHomeRcl: 3,
    minHaulEnergy: 300,
    staleRoomTicks: 1500,
    unsafeRoomCooldown: 500
};

function getSettings(room) {
    if(!room.memory.remote) {
        room.memory.remote = {};
    }

    for(var key in DEFAULT_SETTINGS) {
        if(room.memory.remote[key] === undefined) {
            room.memory.remote[key] = DEFAULT_SETTINGS[key];
        }
    }

    if(!room.memory.remote.rooms) {
        room.memory.remote.rooms = {};
    }

    return room.memory.remote;
}

function getOwnedUsername(room) {
    if(room.controller && room.controller.owner) {
        return room.controller.owner.username;
    }

    for(var name in Game.spawns) {
        return Game.spawns[name].owner.username;
    }

    return null;
}

function isThreateningHostile(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0;
}

function hasThreats(room) {
    return room.find(FIND_HOSTILE_CREEPS, {
        filter: isThreateningHostile
    }).length > 0;
}

function hasHostileTower(room) {
    return room.find(FIND_HOSTILE_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                (!structure.isActive || structure.isActive());
        }
    }).length > 0;
}

function canHarvestRemoteRoom(room) {
    return !!room.controller && !hasThreats(room) && !hasHostileTower(room);
}

function getRoomLinearDistance(homeRoomName, targetRoomName) {
    if(typeof Game.map.getRoomLinearDistance != 'function') {
        return 1;
    }

    return Game.map.getRoomLinearDistance(homeRoomName, targetRoomName);
}

function getApproxRange(fromPos, toPos) {
    if(!fromPos || !toPos) {
        return 9999;
    }

    if(fromPos.roomName == toPos.roomName) {
        return fromPos.getRangeTo(toPos);
    }

    return getRoomLinearDistance(fromPos.roomName, toPos.roomName) * 50 +
        Math.max(Math.abs(fromPos.x - toPos.x), Math.abs(fromPos.y - toPos.y));
}

function getClosestByApproxRange(fromPos, targets) {
    if(!targets.length) {
        return null;
    }

    targets.sort(function(a, b) {
        return getApproxRange(fromPos, a.pos) - getApproxRange(fromPos, b.pos);
    });

    return targets[0];
}

function rememberAdjacentRooms(room, settings) {
    if(typeof Game.map.describeExits != 'function') {
        return;
    }

    var exits = Game.map.describeExits(room.name) || {};
    for(var direction in exits) {
        var roomName = exits[direction];
        if(!settings.rooms[roomName]) {
            settings.rooms[roomName] = {
                enabled: true,
                status: 'unknown',
                distance: getRoomLinearDistance(room.name, roomName)
            };
        }

        settings.rooms[roomName].exit = direction;
    }
}

function updateVisibleRemoteRoom(homeRoom, remoteName, remoteMemory) {
    var remoteRoom = Game.rooms[remoteName];
    if(!remoteRoom) {
        if(remoteMemory.lastScouted &&
            Game.time - remoteMemory.lastScouted > getSettings(homeRoom).staleRoomTicks) {
            remoteMemory.status = 'unknown';
        }
        return;
    }

    remoteMemory.lastScouted = Game.time;
    remoteMemory.distance = getRoomLinearDistance(homeRoom.name, remoteName);

    if(!remoteRoom.controller) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = 'no controller';
        return;
    }

    if(hasThreats(remoteRoom) || hasHostileTower(remoteRoom)) {
        remoteMemory.status = 'unsafe';
        remoteMemory.unsafeUntil = Game.time + getSettings(homeRoom).unsafeRoomCooldown;
        remoteMemory.reason = hasHostileTower(remoteRoom) ? 'hostile tower' : 'combat hostile';
        return;
    }

    var sources = remoteRoom.find(FIND_SOURCES);
    if(!sources.length) {
        remoteMemory.status = 'empty';
        remoteMemory.sourceIds = [];
        return;
    }

    remoteMemory.status = 'ready';
    delete remoteMemory.reason;
    remoteMemory.sourceIds = sources.map(function(source) {
        return source.id;
    });
}

function updateRemoteMemory(room) {
    var settings = getSettings(room);
    if(settings.enabled === false ||
        !room.controller ||
        room.controller.level < settings.minHomeRcl) {
        return settings;
    }

    rememberAdjacentRooms(room, settings);

    for(var remoteName in settings.rooms) {
        updateVisibleRemoteRoom(room, remoteName, settings.rooms[remoteName]);
    }

    return settings;
}

function canUseRemote(room, remoteName, remoteMemory, settings) {
    if(remoteMemory.enabled === false) {
        return false;
    }

    if(remoteMemory.distance && remoteMemory.distance > settings.maxRooms) {
        return false;
    }

    if(remoteMemory.unsafeUntil && Game.time < remoteMemory.unsafeUntil) {
        return false;
    }

    return remoteMemory.status == 'ready' || remoteMemory.status == 'unknown';
}

function getActiveRemoteRooms(room) {
    var settings = getSettings(room);
    var rooms = [];

    for(var remoteName in settings.rooms) {
        if(canUseRemote(room, remoteName, settings.rooms[remoteName], settings)) {
            rooms.push({
                name: remoteName,
                memory: settings.rooms[remoteName]
            });
        }
    }

    rooms.sort(function(a, b) {
        return (a.memory.distance || 1) - (b.memory.distance || 1) ||
            a.name.localeCompare(b.name);
    });

    return rooms.slice(0, settings.maxRooms);
}

function countRemoteCreeps(homeRoomName, role, remoteRoomName, sourceId) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role != role ||
            creep.memory.homeRoom != homeRoomName ||
            creep.memory.targetRoom != remoteRoomName) {
            continue;
        }

        if(sourceId && creep.memory.sourceId != sourceId) {
            continue;
        }

        count++;
    }

    return count;
}

function getRemoteEnergyAmount(remoteRoomName) {
    var remoteRoom = Game.rooms[remoteRoomName];
    if(!remoteRoom) {
        return 0;
    }

    var energy = 0;
    var containers = remoteRoom.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER &&
                structure.store &&
                structure.store[RESOURCE_ENERGY] > 0;
        }
    });

    for(var i = 0; i < containers.length; i++) {
        energy += containers[i].store[RESOURCE_ENERGY];
    }

    var dropped = remoteRoom.find(FIND_DROPPED_RESOURCES, {
        filter: function(resource) {
            return resource.resourceType == RESOURCE_ENERGY;
        }
    });

    for(var j = 0; j < dropped.length; j++) {
        energy += dropped[j].amount;
    }

    return energy;
}

function getSpawnRequest(room) {
    var settings = updateRemoteMemory(room);
    if(settings.enabled === false ||
        !room.controller ||
        room.controller.level < settings.minHomeRcl) {
        return null;
    }

    var rooms = getActiveRemoteRooms(room);
    for(var i = 0; i < rooms.length; i++) {
        var remote = rooms[i];
        var sourceIds = remote.memory.sourceIds || [];

        if(remote.memory.status == 'unknown' || !sourceIds.length) {
            if(countRemoteCreeps(room.name, 'remoteMiner', remote.name) === 0) {
                return {
                    role: 'remoteMiner',
                    bodyType: 'remoteMiner',
                    memory: {
                        role: 'remoteMiner',
                        homeRoom: room.name,
                        targetRoom: remote.name,
                        working: false
                    }
                };
            }
            continue;
        }

        for(var sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex++) {
            if(countRemoteCreeps(room.name, 'remoteMiner', remote.name, sourceIds[sourceIndex]) === 0) {
                return {
                    role: 'remoteMiner',
                    bodyType: 'remoteMiner',
                    memory: {
                        role: 'remoteMiner',
                        homeRoom: room.name,
                        targetRoom: remote.name,
                        sourceId: sourceIds[sourceIndex],
                        working: false
                    }
                };
            }
        }

        var energy = getRemoteEnergyAmount(remote.name);
        var haulers = countRemoteCreeps(room.name, 'remoteHauler', remote.name);
        if(energy >= settings.minHaulEnergy && haulers === 0) {
            return {
                role: 'remoteHauler',
                bodyType: 'remoteHauler',
                memory: {
                    role: 'remoteHauler',
                    homeRoom: room.name,
                    targetRoom: remote.name,
                    working: false
                }
            };
        }
    }

    return null;
}

function findHomeDeliveryTarget(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return null;
    }

    var spawnsAndExtensions = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_SPAWN ||
                structure.structureType == STRUCTURE_EXTENSION) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    if(spawnsAndExtensions.length) {
        return getClosestByApproxRange(creep.pos, spawnsAndExtensions);
    }

    var towers = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                (!structure.isActive || structure.isActive()) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                structure.store[RESOURCE_ENERGY] < Math.min(600, structure.store.getCapacity(RESOURCE_ENERGY));
        }
    });

    if(towers.length) {
        return getClosestByApproxRange(creep.pos, towers);
    }

    var stores = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_STORAGE ||
                structure.structureType == STRUCTURE_TERMINAL) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    return getClosestByApproxRange(creep.pos, stores);
}

function getHomeFallback(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return new RoomPosition(25, 25, creep.memory.homeRoom);
    }

    var spawns = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || homeRoom.controller || new RoomPosition(25, 25, homeRoom.name);
}

function markUnsafe(homeRoomName, targetRoomName, reason) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return;
    }

    var settings = getSettings(homeRoom);
    if(!settings.rooms[targetRoomName]) {
        settings.rooms[targetRoomName] = {};
    }

    settings.rooms[targetRoomName].status = 'unsafe';
    settings.rooms[targetRoomName].reason = reason || 'hostile threat';
    settings.rooms[targetRoomName].unsafeUntil = Game.time + settings.unsafeRoomCooldown;
}

function moveHome(creep, intent) {
    creepUtils.moveTo(
        creep,
        getHomeFallback(creep),
        '#ff66cc',
        intent || 'home',
        'move:' + (intent || 'remoteHome')
    );
    return true;
}

function findRemoteEnergyTarget(creep, homeRoomName) {
    var homeRoom = Game.rooms[homeRoomName || creep.memory.homeRoom || creep.room.name];
    if(!homeRoom) {
        return null;
    }

    var settings = getSettings(homeRoom);
    if(settings.enabled === false) {
        return null;
    }

    var rooms = getActiveRemoteRooms(homeRoom);
    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < rooms.length; i++) {
        var remoteRoom = Game.rooms[rooms[i].name];
        if(!remoteRoom || hasThreats(remoteRoom)) {
            continue;
        }

        var containers = remoteRoom.find(FIND_STRUCTURES, {
            filter: function(structure) {
                return structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store &&
                    structure.store[RESOURCE_ENERGY] >= Math.min(100, creep.store.getFreeCapacity(RESOURCE_ENERGY));
            }
        });

        for(var c = 0; c < containers.length; c++) {
            var score = getApproxRange(creep.pos, containers[c].pos) - containers[c].store[RESOURCE_ENERGY] / 100;
            if(score < bestScore) {
                best = containers[c];
                bestScore = score;
            }
        }

        var dropped = remoteRoom.find(FIND_DROPPED_RESOURCES, {
            filter: function(resource) {
                return resource.resourceType == RESOURCE_ENERGY &&
                    resource.amount >= Math.min(100, creep.store.getFreeCapacity(RESOURCE_ENERGY));
            }
        });

        for(var d = 0; d < dropped.length; d++) {
            var droppedScore = getApproxRange(creep.pos, dropped[d].pos) - dropped[d].amount / 100;
            if(droppedScore < bestScore) {
                best = dropped[d];
                bestScore = droppedScore;
            }
        }
    }

    return best;
}

function withdrawOrPickup(creep, target) {
    if(!target) {
        return false;
    }

    if(target.resourceType) {
        var pickupResult = creep.pickup(target);
        if(pickupResult == ERR_NOT_IN_RANGE) {
            creepUtils.moveTo(creep, target, '#ffaa00', 'remote haul', 'move:remotePickup');
            return true;
        }

        if(pickupResult == OK) {
            creepUtils.announceIntent(creep, 'action:remotePickup', 'pickup');
            return true;
        }

        return false;
    }

    var withdrawResult = creep.withdraw(target, RESOURCE_ENERGY);
    if(withdrawResult == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#ffaa00', 'remote haul', 'move:remoteWithdraw');
        return true;
    }

    if(withdrawResult == OK) {
        creepUtils.announceIntent(creep, 'action:remoteWithdraw', 'haul');
        return true;
    }

    return false;
}

function deliverHome(creep) {
    var target = findHomeDeliveryTarget(creep);
    if(!target) {
        var homeRoom = Game.rooms[creep.memory.homeRoom];
        if(homeRoom && homeRoom.controller) {
            creepUtils.moveTo(creep, homeRoom.controller, '#ffffff', 'home', 'move:remoteHome');
            return true;
        }

        return false;
    }

    return creepUtils.transferEnergy(creep, target);
}

function run(room) {
    updateRemoteMemory(room);
}

module.exports = {
    deliverHome: deliverHome,
    findRemoteEnergyTarget: findRemoteEnergyTarget,
    getSettings: getSettings,
    getSpawnRequest: getSpawnRequest,
    hasHostileTower: hasHostileTower,
    hasThreats: hasThreats,
    canHarvestRemoteRoom: canHarvestRemoteRoom,
    markUnsafe: markUnsafe,
    moveHome: moveHome,
    run: run,
    withdrawOrPickup: withdrawOrPickup
};
