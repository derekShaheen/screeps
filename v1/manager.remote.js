var lifecycle = require('utils.lifecycle');
var creepUtils = require('utils.creep');
var debug = require('utils.debug');

var DEFAULT_SETTINGS = {
    enabled: true,
    maxRooms: 2,
    minHomeRcl: 2,
    claimMinHomeRcl: 6,
    minHaulEnergy: 300,
    reserveRenewBelow: 1200,
    staleRoomTicks: 1500,
    unsafeRoomCooldown: 5000,
    exitAccessCacheTicks: 100,
    priorityFlagName: 'Flag1',
    maxScouts: 1,
    scoutStuckTicks: 25,
    scoutMissionTicks: 300,
    scoutRetryTicks: 250
};

var REMOTE_FULL_HAULER_COST = 600;
var MIN_UNSAFE_ROOM_COOLDOWN = 5000;
var MAX_RESERVATION_SPAWN_DISTANCE = 2;

function getSettings(room) {
    if(!room.memory.remote) {
        room.memory.remote = {};
    }

    for(var key in DEFAULT_SETTINGS) {
        if(room.memory.remote[key] === undefined) {
            room.memory.remote[key] = DEFAULT_SETTINGS[key];
        }
    }

    if(room.memory.remote.minHomeRcl == 1 && DEFAULT_SETTINGS.minHomeRcl < 1) {
        room.memory.remote.minHomeRcl = DEFAULT_SETTINGS.minHomeRcl;
    }

    if(!room.memory.remote.rooms) {
        room.memory.remote.rooms = {};
    }

    if(room.memory.remote.explorationVersion !== 2) {
        for(var remoteName in room.memory.remote.rooms) {
            var record = room.memory.remote.rooms[remoteName];
            delete record.exitAccessible;
            delete record.exitAccessChecked;
            if(record.reason == 'exit inaccessible') {
                record.status = 'unknown';
                delete record.reason;
            }
        }
        room.memory.remote.explorationVersion = 2;
    }
    return room.memory.remote;
}

function getMyUsername() {
    for(var name in Game.spawns) {
        return Game.spawns[name].owner.username;
    }

    return null;
}

function getOwnedRooms() {
    var rooms = [];
    for(var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if(room.controller && room.controller.my) {
            rooms.push(room);
        }
    }

    return rooms;
}

function getUnsafeRoomMemory() {
    if(!Memory.remote) {
        Memory.remote = {};
    }

    if(!Memory.remote.unsafeRooms) {
        Memory.remote.unsafeRooms = {};
    }

    return Memory.remote.unsafeRooms;
}

function getUnsafeRoomRecord(roomName) {
    var unsafeRooms = getUnsafeRoomMemory();
    var record = unsafeRooms[roomName];
    if(record && record.unsafeUntil && record.unsafeUntil <= Game.time) {
        // Retain encounter history so another colony also backs off on a retry.
        return null;
    }

    return record || null;
}

function isGloballyUnsafeRoom(roomName) {
    return !!getUnsafeRoomRecord(roomName);
}

function clearGlobalUnsafeRoom(roomName) {
    var unsafeRooms = getUnsafeRoomMemory();
    if(unsafeRooms[roomName]) {
        delete unsafeRooms[roomName];
    }
}

function getUnsafeCooldown(settings) {
    var cooldown = settings && typeof settings.unsafeRoomCooldown == 'number' ?
        settings.unsafeRoomCooldown :
        DEFAULT_SETTINGS.unsafeRoomCooldown;

    return Math.max(MIN_UNSAFE_ROOM_COOLDOWN, cooldown);
}

function getClosestOwnedSpawnRoomDistance(roomName) {
    var rooms = getOwnedRooms();
    var bestDistance = 999999;

    for(var i = 0; i < rooms.length; i++) {
        if(!hasOwnedSpawn(rooms[i])) {
            continue;
        }

        bestDistance = Math.min(bestDistance, getRoomLinearDistance(rooms[i].name, roomName));
    }

    return bestDistance;
}

function isWithinReservationSpawnRange(roomName) {
    return getClosestOwnedSpawnRoomDistance(roomName) <= MAX_RESERVATION_SPAWN_DISTANCE;
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

function getHarvestBlockReason(room) {
    if(!room.controller) {
        return 'no controller';
    }

    var username = getMyUsername();
    if(room.controller.owner && !room.controller.my) {
        return 'controller owned by ' + room.controller.owner.username;
    }

    if(room.controller.reservation &&
        username &&
        room.controller.reservation.username != username) {
        return 'controller reserved by ' + room.controller.reservation.username;
    }

    return null;
}

function canHarvestRemoteRoom(room) {
    return !getHarvestBlockReason(room) &&
        !hasThreats(room) &&
        !hasHostileTower(room);
}

function rememberUnsafeRemote(settings, remoteMemory, remoteName, reason) {
    // Danger is shared across colonies. Repeated sightings belong to one encounter,
    // and no colony may shorten an existing quarantine.
    var shared = getUnsafeRoomMemory()[remoteName] || {};
    var existingUntil = Math.max(remoteMemory.unsafeUntil || 0, shared.unsafeUntil || 0);
    var attempts = Math.max(remoteMemory.unsafeAttempts || 0, shared.attempts || 0);
    var active = existingUntil > Game.time;
    attempts = active ? Math.max(1, attempts) : attempts + 1;
    var unsafeUntil = active ? existingUntil :
        Game.time + getUnsafeCooldown(settings) * Math.min(attempts, 10);

    remoteMemory.status = 'unsafe';
    remoteMemory.reason = reason || 'hostile threat';
    remoteMemory.unsafeAttempts = attempts;
    remoteMemory.unsafeUntil = unsafeUntil;
    getUnsafeRoomMemory()[remoteName] = {
        reason: remoteMemory.reason,
        unsafeUntil: unsafeUntil,
        attempts: attempts,
        lastSeen: Game.time
    };
}

function isPersistentRemoteBlockReason(reason) {
    if(!reason) {
        return false;
    }

    return reason == 'hostile tower' ||
        reason == 'no controller' ||
        reason.indexOf('controller owned by ') === 0 ||
        reason.indexOf('controller reserved by ') === 0;
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

function isUnsafeVisibleRoom(room) {
    return !!room && (hasThreats(room) || hasHostileTower(room));
}

function hasRememberedHostileTower(remoteName, remoteMemory) {
    var shared = getUnsafeRoomMemory()[remoteName];
    return !!((remoteMemory && remoteMemory.reason == 'hostile tower') ||
        (shared && shared.reason == 'hostile tower'));
}

function shouldAvoidTravelRoom(homeRoomName, roomName, destinationRoomName) {
    if(!roomName || roomName == homeRoomName) {
        return false;
    }

    if(isGloballyUnsafeRoom(roomName) || hasRememberedHostileTower(roomName)) {
        return true;
    }

    var visibleRoom = Game.rooms[roomName];
    if(isUnsafeVisibleRoom(visibleRoom)) {
        return true;
    }

    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return false;
    }

    var settings = getSettings(homeRoom);
    var remoteMemory = settings.rooms && settings.rooms[roomName] ? settings.rooms[roomName] : null;
    if(hasRememberedHostileTower(roomName, remoteMemory) ||
        (remoteMemory && remoteMemory.unsafeUntil > Game.time)) { return true; }
    // Expired danger may be revisited as a deliberate destination, never as transit.
    if(roomName == destinationRoomName) { return false; }
    return !!remoteMemory && (remoteMemory.status == 'unsafe' ||
        (remoteMemory.status == 'unknown' &&
            (remoteMemory.reason == 'combat hostile' || remoteMemory.reason == 'hostile tower')));
}

function getRemoteTravelOptions(homeRoomName, destinationRoomName) {
    return {
        routeCallback: function(roomName, fromRoomName) {
            if(!isAccessibleRemoteMapRoom(homeRoomName, roomName)) { return Infinity; }
            var home = Game.rooms[homeRoomName];
            var settings = home && getSettings(home);
            var record = settings && settings.rooms[roomName];
            var edge = record && record.exitAccessByRoom && record.exitAccessByRoom[fromRoomName];
            if(edge && !edge.accessible && Game.time - edge.tick < settings.exitAccessCacheTicks) {
                return Infinity;
            }
            if(shouldAvoidTravelRoom(homeRoomName, roomName, destinationRoomName)) {
                return Infinity;
            }

            return 1;
        }
    };
}

function moveToRoom(creep, roomName, stroke, intentMessage, intentKey) {
    if(!creep || !roomName) {
        return false;
    }

    return creepUtils.moveTo(
        creep,
        new RoomPosition(25, 25, roomName),
        stroke,
        intentMessage,
        intentKey,
        getRemoteTravelOptions(creep.memory.homeRoom || creep.room.name, roomName)
    );
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

function getMapRoomStatus(roomName) {
    if(!roomName || !Game.map.getRoomStatus) {
        return 'normal';
    }

    var status;
    try {
        status = Game.map.getRoomStatus(roomName);
    }
    catch(err) {
        debug.log(
            'debugRemote',
            'map status unavailable for ' + roomName + ': ' + err,
            20
        );
        return 'normal';
    }

    return status && status.status ? status.status : 'normal';
}

function isAccessibleMapRoom(roomName) {
    return getMapRoomStatus(roomName) == 'normal';
}

function isAccessibleRemoteMapRoom(homeRoomName, remoteRoomName) {
    var remoteStatus = getMapRoomStatus(remoteRoomName);
    if(remoteStatus == 'normal') {
        return true;
    }

    return !!homeRoomName &&
        remoteStatus == 'novice' &&
        getMapRoomStatus(homeRoomName) == 'novice';
}

function hasPriorityRemoteFlag(roomName, settings) {
    var flagName = settings && settings.priorityFlagName ?
        settings.priorityFlagName :
        DEFAULT_SETTINGS.priorityFlagName;
    var flag = Game.flags[flagName];

    return !!flag && flag.pos.roomName == roomName;
}

function getPrimaryHomeAnchor(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || room.controller || null;
}

function isPassableStructure(structure) {
    if(structure.structureType == STRUCTURE_ROAD ||
        structure.structureType == STRUCTURE_CONTAINER) {
        return true;
    }

    return structure.structureType == STRUCTURE_RAMPART &&
        (structure.my || structure.isPublic);
}

function addExitAccessCosts(room, costs) {
    var structures = room.find(FIND_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType == STRUCTURE_ROAD) {
            costs.set(structures[i].pos.x, structures[i].pos.y, 1);
            continue;
        }

        if(structures[i].structureType == STRUCTURE_CONTAINER ||
            (structures[i].structureType == STRUCTURE_RAMPART &&
            (structures[i].my || structures[i].isPublic))) {
            costs.set(structures[i].pos.x, structures[i].pos.y, 2);
            continue;
        }

        costs.set(structures[i].pos.x, structures[i].pos.y, 255);
    }

    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for(var j = 0; j < sites.length; j++) {
        if(sites[j].structureType == STRUCTURE_ROAD) {
            costs.set(sites[j].pos.x, sites[j].pos.y, 1);
            continue;
        }

        if(sites[j].structureType == STRUCTURE_RAMPART && sites[j].my !== false) {
            costs.set(sites[j].pos.x, sites[j].pos.y, 2);
            continue;
        }

        if(sites[j].structureType == STRUCTURE_WALL) {
            costs.set(sites[j].pos.x, sites[j].pos.y, 255);
        }
    }
}

function getExitFindConstant(direction) {
    var value = parseInt(direction, 10);
    if(value == FIND_EXIT_TOP ||
        value == FIND_EXIT_RIGHT ||
        value == FIND_EXIT_BOTTOM ||
        value == FIND_EXIT_LEFT) {
        return value;
    }

    return null;
}

function hasOpenExitTile(room, exitPositions) {
    for(var i = 0; i < exitPositions.length; i++) {
        if(room.getTerrain().get(exitPositions[i].x, exitPositions[i].y) == TERRAIN_MASK_WALL) {
            continue;
        }

        var structures = exitPositions[i].lookFor(LOOK_STRUCTURES);
        var blocked = false;
        for(var j = 0; j < structures.length; j++) {
            if(!isPassableStructure(structures[j])) {
                blocked = true;
                break;
            }
        }

        if(!blocked) {
            return true;
        }
    }

    return false;
}

function canReachExit(room, exitPositions) {
    if(!exitPositions.length || typeof PathFinder === 'undefined') {
        return exitPositions.length > 0;
    }

    var anchor = getPrimaryHomeAnchor(room);
    if(!anchor) {
        return true;
    }

    var goals = [];
    for(var i = 0; i < exitPositions.length; i++) {
        goals.push({
            pos: exitPositions[i],
            range: 0
        });
    }

    var result = PathFinder.search(anchor.pos || anchor, goals, {
        plainCost: 2,
        swampCost: 10,
        maxRooms: 1,
        maxOps: 2000,
        roomCallback: function(roomName) {
            if(roomName != room.name) {
                return false;
            }

            var costs = new PathFinder.CostMatrix();
            addExitAccessCosts(room, costs);
            return costs;
        }
    });

    return !result.incomplete && result.path.length > 0;
}

function hasAccessibleExit(room, direction, remoteMemory, settings) {
    if(!direction) { return true; }
    var cacheTicks = Math.max(1, settings.exitAccessCacheTicks || 100);
    var edges = remoteMemory.exitAccessByRoom || (remoteMemory.exitAccessByRoom = {});
    var cached = edges[room.name];
    if(cached && cached.direction == direction && Game.time - cached.tick < cacheTicks) {
        return cached.accessible;
    }
    var constant = getExitFindConstant(direction);
    var exits = constant === null ? [] : room.find(constant);
    var accessible = hasOpenExitTile(room, exits) && canReachExit(room, exits);
    edges[room.name] = {direction: direction, accessible: accessible, tick: Game.time};
    return accessible;
}

function rememberAdjacentRooms(room, settings, homeRoomName) {
    if(typeof Game.map.describeExits != 'function') {
        return;
    }

    homeRoomName = homeRoomName || room.name;
    var exits = Game.map.describeExits(room.name) || {};
    for(var direction in exits) {
        var roomName = exits[direction];
        if(roomName == homeRoomName) {
            continue;
        }

        var mapStatus = getMapRoomStatus(roomName);
        var distance = getRoomLinearDistance(homeRoomName, roomName);
        if(!settings.rooms[roomName]) {
            settings.rooms[roomName] = {
                enabled: true,
                status: 'unknown',
                distance: distance,
                parentRoom: room.name
            };
        }

        if(settings.rooms[roomName].distance === undefined ||
            distance < settings.rooms[roomName].distance) {
            settings.rooms[roomName].distance = distance;
            settings.rooms[roomName].parentRoom = room.name;
        }

        settings.rooms[roomName].exit = direction;
        settings.rooms[roomName].mapStatus = mapStatus;
        if(!isAccessibleRemoteMapRoom(homeRoomName, roomName)) {
            settings.rooms[roomName].status = 'blocked';
            settings.rooms[roomName].reason = 'map status ' + mapStatus;
            continue;
        }

        // Accessibility belongs to this directed connection, not the destination.
        hasAccessibleExit(room, direction, settings.rooms[roomName], settings);

        if(settings.rooms[roomName].status == 'blocked' &&
            settings.rooms[roomName].reason &&
            (settings.rooms[roomName].reason.indexOf('map status ') === 0 ||
            settings.rooms[roomName].reason == 'exit inaccessible')) {
            settings.rooms[roomName].status = 'unknown';
            delete settings.rooms[roomName].reason;
        }
    }
}

function updateVisibleRemoteRoom(homeRoom, remoteName, remoteMemory) {
    remoteMemory.mapStatus = getMapRoomStatus(remoteName);
    if(!isAccessibleRemoteMapRoom(homeRoom.name, remoteName)) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = 'map status ' + remoteMemory.mapStatus;
        return;
    }

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
    remoteMemory.controllerOwner = remoteRoom.controller && remoteRoom.controller.owner ? remoteRoom.controller.owner.username : null;
    remoteMemory.hasController = !!remoteRoom.controller;
    rememberAdjacentRooms(remoteRoom, getSettings(homeRoom), homeRoom.name);
    if(hasThreats(remoteRoom) || hasHostileTower(remoteRoom)) {
        var threatSettings = getSettings(homeRoom);
        rememberUnsafeRemote(threatSettings, remoteMemory, remoteName,
            hasHostileTower(remoteRoom) ? 'hostile tower' : 'combat hostile');
        return;
    }
    // A temporary absence of an attacker is not proof that the room is safe.
    var sharedDanger = getUnsafeRoomRecord(remoteName);
    if(sharedDanger || remoteMemory.unsafeUntil > Game.time) {
        if(sharedDanger) {
            remoteMemory.unsafeUntil = Math.max(remoteMemory.unsafeUntil || 0, sharedDanger.unsafeUntil);
            remoteMemory.unsafeAttempts = Math.max(remoteMemory.unsafeAttempts || 0, sharedDanger.attempts || 1);
            remoteMemory.reason = sharedDanger.reason || remoteMemory.reason;
        }
        remoteMemory.status = 'unsafe';
        return;
    }
    clearGlobalUnsafeRoom(remoteName);
    delete remoteMemory.unsafeUntil;
    delete remoteMemory.unsafeAttempts;

    if(!remoteRoom.controller) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = 'no controller';
        delete remoteMemory.reservationUsername;
        remoteMemory.reservationTicks = 0;
        remoteMemory.reservationObservedTick = Game.time;
        return;
    }

    remoteMemory.reservationUsername = remoteRoom.controller.reservation ?
        remoteRoom.controller.reservation.username :
        null;
    remoteMemory.reservationTicks = remoteRoom.controller.reservation ?
        remoteRoom.controller.reservation.ticksToEnd :
        0;
    remoteMemory.reservationObservedTick = Game.time;

    var harvestBlockReason = getHarvestBlockReason(remoteRoom);
    if(harvestBlockReason) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = harvestBlockReason;
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
    delete remoteMemory.unsafeAttempts;
    remoteMemory.sourceIds = sources.map(function(source) {
        return source.id;
    });
    rememberRemoteHarvestSlots(remoteMemory, sources);
}

function updateRemoteMemory(room) {
    if(room._remoteMemoryCacheTick === Game.time) {
        return room.memory.remote;
    }
    room._remoteMemoryCacheTick = Game.time;

    var settings = getSettings(room);
    if(settings.enabled === false ||
        !room.controller ||
        room.controller.level < settings.minHomeRcl) {
        return settings;
    }

    var priorityFlag = Game.flags[settings.priorityFlagName];
    if(priorityFlag && priorityFlag.pos.roomName != room.name && !settings.rooms[priorityFlag.pos.roomName]) {
        settings.rooms[priorityFlag.pos.roomName] = {enabled: true, status: 'unknown',
            distance: getRoomLinearDistance(room.name, priorityFlag.pos.roomName)};
    }
    rememberAdjacentRooms(room, settings, room.name);

    for(var remoteName in settings.rooms) {
        updateVisibleRemoteRoom(room, remoteName, settings.rooms[remoteName]);
    }

    return settings;
}

function canScoutRoom(room, remoteName, remoteMemory, settings) {
    if(!room || !room.controller || !room.controller.my || settings.enabled === false ||
        room.controller.level < settings.minHomeRcl || remoteMemory.enabled === false ||
        !isAccessibleRemoteMapRoom(room.name, remoteName) ||
        (remoteMemory.distance && remoteMemory.distance > settings.maxRooms) ||
        isGloballyUnsafeRoom(remoteName) ||
        hasRememberedHostileTower(remoteName, remoteMemory) ||
        (remoteMemory.unsafeUntil && Game.time < remoteMemory.unsafeUntil) ||
        (remoteMemory.scoutRetryUntil && Game.time < remoteMemory.scoutRetryUntil)) { return false; }
    if(Game.rooms[remoteName]) { return false; }
    // Old economic exclusions are observations, not permanent scouting bans.
    return !remoteMemory.lastScouted || Game.time - remoteMemory.lastScouted >= settings.staleRoomTicks;
}

function canUseRemote(room, remoteName, remoteMemory, settings) {
    if(settings.enabled === false || !room.controller || room.controller.level < settings.minHomeRcl) { return false; }
    if(!isAccessibleRemoteMapRoom(room.name, remoteName)) {
        return false;
    }

    if(isGloballyUnsafeRoom(remoteName)) {
        return false;
    }


    if(remoteMemory.enabled === false) {
        return false;
    }

    if(remoteMemory.distance && remoteMemory.distance > settings.maxRooms) {
        return false;
    }

    if(remoteMemory.unsafeUntil && Game.time < remoteMemory.unsafeUntil) {
        return false;
    }

    if(isPersistentRemoteBlockReason(remoteMemory.reason)) {
        return false;
    }

    if(remoteMemory.status == 'unknown' && remoteMemory.unsafeAttempts > 0) {
        return false;
    }

    return remoteMemory.status == 'ready' || remoteMemory.status == 'unknown';
}

function isRemoteUsable(homeRoomName, targetRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return false;
    }

    var settings = updateRemoteMemory(homeRoom);
    var remoteMemory = settings.rooms[targetRoomName];
    if(!remoteMemory) {
        return false;
    }

    return canUseRemote(homeRoom, targetRoomName, remoteMemory, settings);
}

function isRemoteScoutable(homeRoomName, targetRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return false;
    }

    var settings = updateRemoteMemory(homeRoom);
    var remoteMemory = settings.rooms[targetRoomName];
    if(!remoteMemory) {
        return false;
    }

    return canScoutRoom(homeRoom, targetRoomName, remoteMemory, settings);
}

function getHomeExplorationBlockers(room, memory, settings) {
    var blockers = [];

    if(!settings) {
        blockers.push('remote memory missing');
        return blockers;
    }

    if(settings.enabled === false) {
        blockers.push('remote.enabled=false');
    }

    if(!room) {
        blockers.push('home room not visible');
        return blockers;
    }

    if(!room.controller || !room.controller.my) {
        blockers.push('home controller not owned');
    }
    else if(room.controller.level < settings.minHomeRcl) {
        blockers.push('RCL ' + room.controller.level + ' < minHomeRcl ' + settings.minHomeRcl);
    }

    return blockers;
}

function getRemoteExplorationBlockers(room, remoteName, remoteMemory, settings) {
    var blockers = [];

    if(!remoteMemory) {
        blockers.push('remote memory missing');
        return blockers;
    }

    if(remoteMemory.enabled === false) {
        blockers.push('remote disabled');
    }

    var mapAccessible = room ?
        isAccessibleRemoteMapRoom(room.name, remoteName) :
        isAccessibleMapRoom(remoteName);

    if(!mapAccessible) {
        blockers.push('map status ' + getMapRoomStatus(remoteName));
    }

    if(hasRememberedHostileTower(remoteName, remoteMemory)) {
        blockers.push('hostile tower requires a fresh safe observation');
    }

    if(remoteMemory.exitAccessible === false) {
        blockers.push('exit inaccessible');
    }

    if(remoteMemory.distance && remoteMemory.distance > settings.maxRooms) {
        blockers.push('distance ' + remoteMemory.distance + ' > maxRooms ' + settings.maxRooms);
    }

    if(remoteMemory.unsafeUntil && remoteMemory.unsafeUntil > Game.time) {
        blockers.push('unsafe cooldown ' + (remoteMemory.unsafeUntil - Game.time));
    }

    var unsafeRecord = getUnsafeRoomRecord(remoteName);
    if(unsafeRecord) {
        blockers.push('global unsafe cooldown ' + (unsafeRecord.unsafeUntil - Game.time));
    }

    if((remoteMemory.status == 'ready' || remoteMemory.status == 'unknown') &&
        isPersistentRemoteBlockReason(remoteMemory.reason) &&
        !(room && needsRemoteScout(room, remoteName, remoteMemory, settings))) {
        blockers.push('remembered ' + remoteMemory.reason);
    }

    if(remoteMemory.status != 'ready' && remoteMemory.status != 'unknown') {
        blockers.push('status ' + (remoteMemory.status || 'unknown') + (remoteMemory.reason ? ': ' + remoteMemory.reason : ''));
    }

    return blockers;
}

function copySharedRemoteMemory(room, remoteName, sourceMemory) {
    var settings = getSettings(room);
    if(!settings.rooms[remoteName]) {
        settings.rooms[remoteName] = {};
    }

    var memory = settings.rooms[remoteName];
    var sourceIsNewer = sourceMemory.lastScouted &&
        (!memory.lastScouted || sourceMemory.lastScouted > memory.lastScouted);

    if(sourceIsNewer || memory.status === undefined || memory.status == 'unknown') {
        var fields = [
            'enabled',
            'status',
            'reason',
            'sourceIds',
            'controllerOwner',
            'hasController',
            'sourceHarvestSlots',
            'harvestSlots',
            'reservationUsername',
            'reservationTicks',
            'reservationObservedTick',
            'lastScouted',
            'mapStatus',
            'unsafeAttempts',
            'unsafeUntil'
        ];

        for(var i = 0; i < fields.length; i++) {
            var key = fields[i];
            if(sourceMemory[key] === undefined) {
                delete memory[key];
            }
            else if(key == 'sourceIds' && sourceMemory.sourceIds) {
                memory.sourceIds = sourceMemory.sourceIds.slice();
            }
            else if(key == 'sourceHarvestSlots' && sourceMemory.sourceHarvestSlots) {
                memory.sourceHarvestSlots = {};
                for(var sourceId in sourceMemory.sourceHarvestSlots) {
                    memory.sourceHarvestSlots[sourceId] = sourceMemory.sourceHarvestSlots[sourceId];
                }
            }
            else {
                memory[key] = sourceMemory[key];
            }
        }
    }

    memory.distance = getRoomLinearDistance(room.name, remoteName);
    return memory;
}

function isClosestSpawnRoomForRemote(room, remoteName) {
    var ownedRooms = getOwnedRooms();
    var bestRoomName = null;
    var bestDistance = 999999;

    for(var i = 0; i < ownedRooms.length; i++) {
        var candidateRoom = ownedRooms[i];
        if(!hasOwnedSpawn(candidateRoom)) {
            continue;
        }

        var settings = getSettings(candidateRoom);
        if(settings.enabled === false ||
            !candidateRoom.controller ||
            candidateRoom.controller.level < settings.minHomeRcl) {
            continue;
        }

        var distance = getRoomLinearDistance(candidateRoom.name, remoteName);
        if(distance > settings.maxRooms) {
            continue;
        }

        if(distance < bestDistance ||
            (distance == bestDistance &&
            (!bestRoomName || candidateRoom.name.localeCompare(bestRoomName) < 0))) {
            bestDistance = distance;
            bestRoomName = candidateRoom.name;
        }
    }

    return !bestRoomName || bestRoomName == room.name;
}

function addRemoteCandidate(room, settings, remoteName, remoteMemory, roomsByName) {
    if(remoteName == room.name || roomsByName[remoteName]) {
        return;
    }

    if(!isClosestSpawnRoomForRemote(room, remoteName)) {
        return;
    }

    var visibleRemote = Game.rooms[remoteName];
    if(visibleRemote &&
        visibleRemote.controller &&
        visibleRemote.controller.my &&
        hasOwnedSpawn(visibleRemote)) {
        return;
    }

    if(canUseRemote(room, remoteName, remoteMemory, settings)) {
        roomsByName[remoteName] = {
            name: remoteName,
            memory: remoteMemory,
            priorityFlag: hasPriorityRemoteFlag(remoteName, settings),
            spawnDistance: getRoomLinearDistance(room.name, remoteName)
        };
    }
}

function getActiveRemoteRooms(room) {
    var settings = getSettings(room);
    var roomsByName = {};

    for(var remoteName in settings.rooms) {
        addRemoteCandidate(room, settings, remoteName, settings.rooms[remoteName], roomsByName);
    }

    var ownedRooms = getOwnedRooms();
    for(var i = 0; i < ownedRooms.length; i++) {
        if(ownedRooms[i].name == room.name) {
            continue;
        }

        var otherSettings = updateRemoteMemory(ownedRooms[i]);
        if(otherSettings.enabled === false || !otherSettings.rooms) {
            continue;
        }

        for(var sharedName in otherSettings.rooms) {
            var sharedMemory = copySharedRemoteMemory(room, sharedName, otherSettings.rooms[sharedName]);
            addRemoteCandidate(room, settings, sharedName, sharedMemory, roomsByName);
        }
    }

    var rooms = [];
    for(var candidateName in roomsByName) {
        rooms.push(roomsByName[candidateName]);
    }

    rooms.sort(function(a, b) {
        if(a.priorityFlag != b.priorityFlag) {
            return a.priorityFlag ? -1 : 1;
        }

        return (a.spawnDistance || a.memory.distance || 1) - (b.spawnDistance || b.memory.distance || 1) ||
            (a.memory.distance || 1) - (b.memory.distance || 1) ||
            a.name.localeCompare(b.name);
    });

    return rooms;
}

function getRoomReportLine(roomName, remoteName, remoteMemory) {
    var status = remoteMemory.status || 'unknown';
    var visible = Game.rooms[remoteName] ? 'visible' : 'unseen';
    var sources = remoteMemory.sourceIds ? remoteMemory.sourceIds.length : '?';
    var slots = remoteMemory.harvestSlots || (remoteMemory.sourceIds ? remoteMemory.sourceIds.length : '?');
    var assignedSlots = '?';
    var unassignedMiners = countUnassignedRemoteMiners(remoteName);
    var distance = remoteMemory.distance === undefined ? '?' : remoteMemory.distance;
    var mapStatus = remoteMemory.mapStatus ? ' map=' + remoteMemory.mapStatus : '';
    var reserve = ' reserve=' +
        (remoteMemory.reservationUsername ? remoteMemory.reservationUsername : 'none') +
        ':' + getEstimatedReservationTicks(remoteMemory);
    var unsafe = remoteMemory.unsafeUntil && remoteMemory.unsafeUntil > Game.time ?
        ' cooldown ' + (remoteMemory.unsafeUntil - Game.time) :
        '';
    var reason = remoteMemory.reason ? ' ' + remoteMemory.reason : '';
    var enabled = remoteMemory.enabled === false ? ' disabled' : '';
    var homeRoom = Game.rooms[roomName];
    var homeMemory = Memory.rooms && Memory.rooms[roomName] ? Memory.rooms[roomName] : null;
    var settings = homeRoom ? getSettings(homeRoom) : (homeMemory ? homeMemory.remote : null);
    var priorityFlag = hasPriorityRemoteFlag(remoteName, settings) ?
        ' priorityFlag=' + (settings.priorityFlagName || DEFAULT_SETTINGS.priorityFlagName) :
        '';
    var blockers = settings ? getRemoteExplorationBlockers(homeRoom, remoteName, remoteMemory, settings) : ['remote memory missing'];
    var decision = blockers.length ? ' blockedBy=' + blockers.join(', ') : ' eligible';

    if(remoteMemory.sourceIds && remoteMemory.sourceIds.length) {
        assignedSlots = 0;
        for(var i = 0; i < remoteMemory.sourceIds.length; i++) {
            var sourceId = remoteMemory.sourceIds[i];
            var sourceCapacity = getRemoteSourceHarvestCapacity(remoteMemory, sourceId);
            assignedSlots += Math.min(
                countRemoteCreeps(null, 'remoteMiner', remoteName, sourceId),
                sourceCapacity
            );
        }
    }

    return roomName + ' -> ' + remoteName +
        ' status=' + status +
        ' ' + visible +
        mapStatus +
        ' dist=' + distance +
        ' scout=' + (homeRoom && needsRemoteScout(homeRoom, remoteName, remoteMemory, settings) ? 'due' : 'not-due') +
        (remoteMemory.scoutRetryUntil > Game.time ? ' retryIn=' + (remoteMemory.scoutRetryUntil - Game.time) : '') +
        (remoteMemory.scoutFailure ? ' lastScoutFailure=' + remoteMemory.scoutFailure : '') +
        ' sources=' + sources +
        ' slots=' + assignedSlots + '/' + slots +
        (unassignedMiners ? ' unassignedMiners=' + unassignedMiners : '') +
        reserve +
        unsafe +
        reason +
        enabled +
        priorityFlag +
        decision;
}

function getReport(homeRoomName, spawnManager) {
    var lines = [];
    var roomNames = [];

    if(homeRoomName) {
        roomNames.push(homeRoomName);
    }
    else {
        for(var roomName in Game.rooms) {
            if(Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
                roomNames.push(roomName);
            }
        }
    }

    roomNames.sort();
    for(var i = 0; i < roomNames.length; i++) {
        var room = Game.rooms[roomNames[i]];
        var memory = Memory.rooms && Memory.rooms[roomNames[i]] ? Memory.rooms[roomNames[i]] : null;
        if(!room && !memory) {
            lines.push(roomNames[i] + ' has no visible room or memory');
            continue;
        }

        var settings = room ? updateRemoteMemory(room) : memory.remote;
        if(!settings || !settings.rooms) {
            lines.push(roomNames[i] + ' has no remote discovery memory');
            continue;
        }

        var remoteNames = Object.keys(settings.rooms).sort();
        var homeBlockers = getHomeExplorationBlockers(room, memory, settings);
        lines.push(
            '[' + roomNames[i] + '] remote enabled=' + (settings.enabled !== false) +
                ' maxRooms=' + settings.maxRooms +
                ' minHomeRcl=' + settings.minHomeRcl +
                ' known=' + remoteNames.length +
                ' scoutPolicy=recover-mining-v1' +
                (homeBlockers.length ? ' blockedBy=' + homeBlockers.join(', ') : ' eligible')
        );
        lines.push(getRemoteSpawnReportLine(room, settings, spawnManager));
        for(var creepName in Game.creeps) {
            var scout = Game.creeps[creepName];
            if(scout.memory.role != 'scout' || scout.memory.homeRoom != roomNames[i]) { continue; }
            var route = scout.memory.remoteRoute;
            lines.push('scout ' + creepName + ' room=' + (scout.room ? scout.room.name : '?') +
                ' target=' + (scout.memory.targetRoom || 'none') +
                ' retreat=' + !!scout.memory.scoutRetreat +
                ' route=' + (route && route.rooms ? route.rooms.join(' -> ') : 'none'));
        }

        if(!remoteNames.length) {
            lines.push(roomNames[i] + ' has not discovered adjacent rooms yet');
            continue;
        }

        for(var r = 0; r < remoteNames.length; r++) {
            lines.push(getRoomReportLine(roomNames[i], remoteNames[r], settings.rooms[remoteNames[r]]));
        }
    }

    return lines.join('\n');
}

function countRemoteCreeps(homeRoomName, role, remoteRoomName, sourceId) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role != role ||
            creep.memory.targetRoom != remoteRoomName ||
            ((role == 'remoteMiner' || role == 'remoteHauler' || role == 'reserver') &&
                lifecycle.needsReplacement(creep, creep.memory.homeRoom, remoteRoomName))) {
            continue;
        }

        if(homeRoomName && creep.memory.homeRoom != homeRoomName) {
            continue;
        }

        if(sourceId && creep.memory.sourceId != sourceId) {
            continue;
        }

        count++;
    }

    return count;
}

function countUnassignedRemoteMiners(remoteRoomName) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role == 'remoteMiner' &&
            creep.memory.targetRoom == remoteRoomName &&
            !creep.memory.sourceId) {
            count++;
        }
    }

    return count;
}

function getEstimatedReservationTicks(remoteMemory) {
    if(!remoteMemory || !remoteMemory.reservationTicks) {
        return 0;
    }

    var observedTick = remoteMemory.reservationObservedTick || remoteMemory.lastScouted || Game.time;
    return Math.max(0, remoteMemory.reservationTicks - Math.max(0, Game.time - observedTick));
}

function isRemoteReservedForWork(room, remoteName, remoteMemory) {
    if(!remoteMemory) {
        return false;
    }

    var remoteRoom = Game.rooms[remoteName];
    if(remoteRoom && remoteRoom.controller) {
        if(remoteRoom.controller.my) {
            return true;
        }

        return !!(remoteRoom.controller.reservation &&
            remoteRoom.controller.reservation.username == getMyUsername() &&
            remoteRoom.controller.reservation.ticksToEnd > 0);
    }

    return remoteMemory.reservationUsername == getMyUsername() &&
        getEstimatedReservationTicks(remoteMemory) > 0;
}

function isRemoteOpenForWork(room, remoteName, remoteMemory, settings) {
    if(!room ||
        !remoteMemory ||
        !settings ||
        !canUseRemote(room, remoteName, remoteMemory, settings)) {
        return false;
    }

    var remoteRoom = Game.rooms[remoteName];
    if(remoteRoom) {
        return canHarvestRemoteRoom(remoteRoom);
    }

    return true;
}

function isRemoteWorkable(homeRoomName, targetRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return false;
    }

    var settings = updateRemoteMemory(homeRoom);
    var remoteMemory = settings.rooms[targetRoomName];
    if(!remoteMemory) {
        return false;
    }

    return isRemoteOpenForWork(homeRoom, targetRoomName, remoteMemory, settings);
}

function areRemoteExtractionSlotsFilled(homeRoomName, targetRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return false;
    }

    var settings = updateRemoteMemory(homeRoom);
    var remoteMemory = settings.rooms[targetRoomName];
    if(!remoteMemory ||
        remoteMemory.status != 'ready' ||
        !remoteMemory.sourceIds ||
        remoteMemory.sourceIds.length === 0) {
        return false;
    }

    for(var i = 0; i < remoteMemory.sourceIds.length; i++) {
        var sourceId = remoteMemory.sourceIds[i];
        if(countRemoteCreeps(null, 'remoteMiner', targetRoomName, sourceId) <
            getRemoteSourceHarvestCapacity(remoteMemory, sourceId)) {
            return false;
        }
    }

    return true;
}

function needsRemoteReservation(room, remoteName, remoteMemory, settings) {
    if(!remoteMemory || !settings || !canUseRemote(room, remoteName, remoteMemory, settings)) {
        return false;
    }

    if(!isWithinReservationSpawnRange(remoteName)) {
        return false;
    }

    if(remoteMemory.status != 'ready' || !remoteMemory.sourceIds || !remoteMemory.sourceIds.length) {
        return false;
    }

    var remoteRoom = Game.rooms[remoteName];
    if(remoteRoom && remoteRoom.controller && remoteRoom.controller.my) {
        return false;
    }

    var username = getMyUsername();
    if(!username) {
        return false;
    }

    if(remoteMemory.reservationUsername && remoteMemory.reservationUsername != username) {
        return false;
    }

    return getEstimatedReservationTicks(remoteMemory) < settings.reserveRenewBelow;
}

function needsRemoteScout(room, remoteName, remoteMemory, settings) {
    return !!remoteMemory && canScoutRoom(room, remoteName, remoteMemory, settings);
}

function getScoutSpawnRequest(room) {
    var settings = updateRemoteMemory(room);
    if(settings.enabled === false || !room.controller || room.controller.level < settings.minHomeRcl) { return null; }
    var scouts = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role == 'scout' && creep.memory.homeRoom == room.name) { scouts++; }
    }
    if(scouts >= settings.maxScouts || room._scoutSpawnRequestedTick === Game.time) { return null; }
    var target = getScoutTarget(room.name, null);
    return target ? {role: 'scout', bodyType: 'scout', memory: {role: 'scout', homeRoom: room.name, targetRoom: target}} : null;
}

function failScoutTarget(homeRoomName, roomName, reason) {
    var home = Game.rooms[homeRoomName];
    if(!home || !roomName) { return; }
    var settings = getSettings(home);
    var record = settings.rooms[roomName];
    if(record) {
        record.scoutRetryUntil = Game.time + settings.scoutRetryTicks;
        record.scoutFailure = reason;
    }
}

function makeReserverSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'reserver',
        bodyType: 'reserver',
        memory: {
            role: 'reserver',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function canClaimNewRoom() {
    if(!Game.gcl || typeof Game.gcl.level != 'number') {
        return false;
    }

    var ownedRooms = 0;
    for(var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if(room.controller && room.controller.my) {
            ownedRooms++;
        }
    }

    return ownedRooms < Game.gcl.level;
}

function needsRemoteClaim(room, remoteName, remoteMemory, settings) {
    if(!room || !room.controller || room.controller.level < settings.claimMinHomeRcl) {
        return false;
    }

    if(!canClaimNewRoom()) {
        return false;
    }

    if(!remoteMemory || !canUseRemote(room, remoteName, remoteMemory, settings)) {
        return false;
    }

    if(remoteMemory.status != 'ready' || !remoteMemory.sourceIds || !remoteMemory.sourceIds.length) {
        return false;
    }

    var remoteRoom = Game.rooms[remoteName];
    if(!remoteRoom) {
        return remoteMemory.hasController === true && !remoteMemory.controllerOwner &&
            remoteMemory.lastScouted !== undefined &&
            Game.time - remoteMemory.lastScouted <= settings.staleRoomTicks;
    }
    if(!remoteRoom.controller) { return false; }

    if(remoteRoom.controller.my || remoteRoom.controller.owner) {
        return false;
    }

    if(remoteRoom.controller.reservation &&
        remoteRoom.controller.reservation.username != getMyUsername()) {
        return false;
    }

    return true;
}

function makeClaimerSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'claimer',
        bodyType: 'claimer',
        memory: {
            role: 'claimer',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function getClaimerTarget(homeRoomName, currentTargetRoom) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return null;
    }

    var settings = updateRemoteMemory(homeRoom);
    if(settings.enabled === false) { return null; }
    if(currentTargetRoom &&
        settings.rooms[currentTargetRoom] &&
        needsRemoteClaim(homeRoom, currentTargetRoom, settings.rooms[currentTargetRoom], settings)) {
        return currentTargetRoom;
    }

    var rooms = getActiveRemoteRooms(homeRoom);
    for(var i = 0; i < rooms.length; i++) {
        if(needsRemoteClaim(homeRoom, rooms[i].name, rooms[i].memory, settings) &&
            countRemoteCreeps(null, 'claimer', rooms[i].name) === 0) {
            return rooms[i].name;
        }
    }

    return null;
}

function hasScoutRoute(homeRoomName, fromRoomName, targetRoomName) {
    var route = Game.map.findRoute(fromRoomName, targetRoomName,
        getRemoteTravelOptions(homeRoomName, targetRoomName));
    if(Array.isArray(route) && route.length > 0 && route.length < 64) { return true; }
    failScoutTarget(homeRoomName, targetRoomName, 'no safe scouting route');
    return false;
}

function getScoutPriority(remoteMemory) {
    // Restore known mining first once its safety cooldown has expired.
    // Foreign ownership/reservation is not a productive recovery target.
    var username = getMyUsername();
    var foreign = (remoteMemory.controllerOwner && remoteMemory.controllerOwner != username) ||
        (remoteMemory.reservationUsername && remoteMemory.reservationUsername != username &&
            getEstimatedReservationTicks(remoteMemory) > 0);
    if(foreign) { return 3; }
    if(remoteMemory.sourceIds && remoteMemory.sourceIds.length &&
        (!remoteMemory.reason || remoteMemory.reason == 'combat hostile')) { return 0; }
    return remoteMemory.reason == 'combat hostile' ? 2 : 1;
}

function getDiscoveryTarget(homeRoomName, currentTargetRoom, fromRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return null;
    }

    var settings = updateRemoteMemory(homeRoom);

    var allRooms = [];
    for(var remoteName in settings.rooms) {
        allRooms.push({
            name: remoteName,
            memory: settings.rooms[remoteName],
            priorityFlag: hasPriorityRemoteFlag(remoteName, settings)
        });
    }

    allRooms.sort(function(a, b) {
        if(a.priorityFlag != b.priorityFlag) {
            return a.priorityFlag ? -1 : 1;
        }

        var priority = getScoutPriority(a.memory) - getScoutPriority(b.memory);
        if(priority) { return priority; }
        // Keep an in-flight mission unless a more valuable category becomes due.
        if((a.name == currentTargetRoom) != (b.name == currentTargetRoom)) {
            return a.name == currentTargetRoom ? -1 : 1;
        }
        return (a.memory.distance || 1) - (b.memory.distance || 1) ||
            a.name.localeCompare(b.name);
    });

    for(var i = 0; i < allRooms.length; i++) {
        if(needsRemoteScout(homeRoom, allRooms[i].name, allRooms[i].memory, settings) &&
            (allRooms[i].name == currentTargetRoom ||
                (countRemoteCreeps(null, 'remoteMiner', allRooms[i].name) === 0 &&
                countRemoteCreeps(null, 'scout', allRooms[i].name) === 0)) &&
            hasScoutRoute(homeRoomName, fromRoomName || homeRoomName, allRooms[i].name)) {
            return allRooms[i].name;
        }
    }

    return null;
}

function getScoutTarget(homeRoomName, currentTargetRoom, fromRoomName) {
    return getDiscoveryTarget(homeRoomName, currentTargetRoom, fromRoomName);
}

function getReserverTarget(homeRoomName, currentTargetRoom) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return null;
    }

    var settings = updateRemoteMemory(homeRoom);
    if(currentTargetRoom &&
        settings.rooms[currentTargetRoom] &&
        needsRemoteReservation(homeRoom, currentTargetRoom, settings.rooms[currentTargetRoom], settings)) {
        return currentTargetRoom;
    }

    var rooms = getActiveRemoteRooms(homeRoom);
    for(var i = 0; i < rooms.length; i++) {
        if(needsRemoteReservation(homeRoom, rooms[i].name, rooms[i].memory, settings) &&
            countRemoteCreeps(null, 'reserver', rooms[i].name) === 0) {
            return rooms[i].name;
        }
    }

    return null;
}

function hasSourceContainer(sourceId) {
    if(!sourceId) {
        return false;
    }

    var source = Game.getObjectById(sourceId);
    if(!source) {
        return false;
    }

    return source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER;
        }
    }).length > 0;
}

function isWalkableSourceSlot(room, pos) {
    if(pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) {
        return false;
    }

    if(room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        var type = structures[i].structureType;
        if(type != STRUCTURE_ROAD &&
            type != STRUCTURE_CONTAINER &&
            type != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return true;
}

function countSourceHarvestSlots(source) {
    var slots = 0;
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var pos = new RoomPosition(
                source.pos.x + dx,
                source.pos.y + dy,
                source.pos.roomName
            );

            if(isWalkableSourceSlot(source.room, pos)) {
                slots++;
            }
        }
    }

    return Math.max(slots, 1);
}

function rememberRemoteHarvestSlots(remoteMemory, sources) {
    var slotsBySource = {};
    var totalSlots = 0;

    for(var i = 0; i < sources.length; i++) {
        var slots = countSourceHarvestSlots(sources[i]);
        slotsBySource[sources[i].id] = slots;
        totalSlots += slots;
    }

    remoteMemory.sourceHarvestSlots = slotsBySource;
    remoteMemory.harvestSlots = totalSlots;
}

function getRemoteSourceHarvestCapacity(remoteMemory, sourceId) {
    if(remoteMemory &&
        remoteMemory.sourceHarvestSlots &&
        remoteMemory.sourceHarvestSlots[sourceId]) {
        return Math.max(remoteMemory.sourceHarvestSlots[sourceId], 1);
    }

    return 1;
}

function countRemoteMinerSlots(sourceIds, remoteMemory) {
    var slots = 0;
    for(var i = 0; i < sourceIds.length; i++) {
        slots += getRemoteSourceHarvestCapacity(remoteMemory, sourceIds[i]);
    }

    return slots;
}

function countAssignedRemoteMinerSlots(remoteName, sourceIds, remoteMemory) {
    var slots = 0;
    for(var i = 0; i < sourceIds.length; i++) {
        var sourceId = sourceIds[i];
        slots += Math.min(
            countRemoteCreeps(null, 'remoteMiner', remoteName, sourceId),
            getRemoteSourceHarvestCapacity(remoteMemory, sourceId)
        );
    }

    return slots;
}

function countMinedRemoteSources(remoteName, sourceIds) {
    var minedSources = 0;
    for(var i = 0; i < sourceIds.length; i++) {
        if(countRemoteCreeps(null, 'remoteMiner', remoteName, sourceIds[i]) > 0) {
            minedSources++;
        }
    }

    return minedSources;
}

function countReadyRemoteMinerSources(sourceIds) {
    var readySources = 0;

    for(var i = 0; i < sourceIds.length; i++) {
        if(hasSourceContainer(sourceIds[i])) {
            readySources++;
        }
    }

    return readySources;
}

function makeRemoteSpawnRequest(homeRoomName, remoteName, sourceId) {
    var memory = {
        role: 'remoteMiner',
        homeRoom: homeRoomName,
        targetRoom: remoteName,
        working: false
    };

    if(sourceId) {
        memory.sourceId = sourceId;
    }

    return {
        role: 'remoteMiner',
        bodyType: hasSourceContainer(sourceId) ? 'remoteMiner' : 'remoteStarterMiner',
        memory: memory
    };
}

function makeRemoteHaulerSpawnRequest(homeRoomName, remoteName, smallBody) {
    return {
        role: 'remoteHauler',
        bodyType: smallBody ? 'remoteSmallHauler' : 'remoteHauler',
        memory: {
            role: 'remoteHauler',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function hasOwnedSpawn(room) {
    if(!room) {
        return false;
    }

    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    }).length > 0;
}

function hasSpawnConstructionSite(room) {
    if(!room) {
        return false;
    }

    return room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_SPAWN && site.my !== false;
        }
    }).length > 0;
}

function needsClaimBootstrap(room, remoteName) {
    var remoteRoom = Game.rooms[remoteName];
    if(!room || !remoteRoom || !remoteRoom.controller || !remoteRoom.controller.my) {
        return false;
    }

    return !hasOwnedSpawn(remoteRoom) && hasSpawnConstructionSite(remoteRoom);
}

function makeBootstrapBuilderSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'builder',
        bodyType: 'builder',
        memory: {
            role: 'builder',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
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

function getDesiredRemoteHaulers(remoteName, sourceIds, remoteMemory, energy) {
    var readyMinerSources = countReadyRemoteMinerSources(sourceIds);
    var minedSources = countMinedRemoteSources(remoteName, sourceIds);
    var assignedSlots = countAssignedRemoteMinerSlots(remoteName, sourceIds, remoteMemory);
    var distance = remoteMemory && remoteMemory.distance ? remoteMemory.distance : 1;
    var distanceMultiplier = distance > 1 ? 1.5 : 1;
    var desiredHaulers = Math.ceil(assignedSlots * distanceMultiplier / 2);

    if(energy >= 100 && minedSources > 0) {
        desiredHaulers = Math.max(desiredHaulers, 1);
    }

    if(readyMinerSources > 0) {
        desiredHaulers = Math.max(desiredHaulers, readyMinerSources);
    }

    if(energy >= 600) {
        desiredHaulers = Math.max(desiredHaulers, Math.ceil(energy / 1200));
    }

    return desiredHaulers;
}

function getRemoteHaulerNeed(room, remote, settings) {
    var sourceIds = remote.memory.sourceIds || [];
    var readyMinerSources = countReadyRemoteMinerSources(sourceIds);
    var energy = getRemoteEnergyAmount(remote.name);
    var desiredHaulers = getDesiredRemoteHaulers(remote.name, sourceIds, remote.memory, energy);
    var haulers = countRemoteCreeps(null, 'remoteHauler', remote.name);
    var assignedSlots = countAssignedRemoteMinerSlots(remote.name, sourceIds, remote.memory);

    if(needsRemoteScout(room, remote.name, remote.memory, settings) ||
        !isRemoteOpenForWork(room, remote.name, remote.memory, settings) ||
        desiredHaulers <= 0 ||
        energy < Math.min(settings.minHaulEnergy, 100) ||
        haulers >= desiredHaulers) {
        return null;
    }

    return {
        remote: remote,
        sourceIds: sourceIds,
        readyMinerSources: readyMinerSources,
        assignedSlots: assignedSlots,
        energy: energy,
        desiredHaulers: desiredHaulers,
        haulers: haulers
    };
}

function shouldSpawnSmallRemoteHauler(room, need) {
    return room.energyAvailable < REMOTE_FULL_HAULER_COST ||
        need.haulers < Math.ceil(need.desiredHaulers / 2);
}

function makeRemoteHaulerDecision(room, need) {
    var smallBody = shouldSpawnSmallRemoteHauler(room, need);
    return {
        request: makeRemoteHaulerSpawnRequest(room.name, need.remote.name, smallBody),
        reasons: [],
        detail: need.remote.name + ': haulers ' + need.haulers + '/' + need.desiredHaulers +
            ' for ' + need.assignedSlots + ' assigned slot(s), ' +
            need.readyMinerSources + ' ready source(s), energy=' + need.energy +
            (smallBody ? ', using small hauler' : '')
    };
}

function getRemoteHaulerSpawnDecision(room, settings, rooms) {
    var bestNeed = null;
    var bestScore = -999999;

    for(var i = 0; i < rooms.length; i++) {
        var need = getRemoteHaulerNeed(room, rooms[i], settings);
        if(!need) {
            continue;
        }

        var deficit = need.desiredHaulers - need.haulers;
        var score = deficit * 10000 +
            need.energy +
            need.assignedSlots * 100 -
            ((rooms[i].spawnDistance || rooms[i].memory.distance || 1) * 25);

        if(score > bestScore) {
            bestNeed = need;
            bestScore = score;
        }
    }

    return bestNeed ? makeRemoteHaulerDecision(room, bestNeed) : null;
}

function getRemoteMinerCountForSource(remoteName, sourceId, pendingMiners) {
    var assigned = countRemoteCreeps(null, 'remoteMiner', remoteName, sourceId);
    var pendingForSource = Math.min(Math.max(1 - assigned, 0), pendingMiners.count);
    pendingMiners.count -= pendingForSource;

    return assigned + pendingForSource;
}

function getRemoteMinerSlotCountForSource(remoteName, sourceId, sourceCapacity, pendingMiners) {
    var assigned = countRemoteCreeps(null, 'remoteMiner', remoteName, sourceId);
    var pendingForSource = Math.min(Math.max(sourceCapacity - assigned, 0), pendingMiners.count);
    pendingMiners.count -= pendingForSource;

    return assigned + pendingForSource;
}

function getRemoteSpawnDecision(room, settings) {
    var reasons = [];
    var homeBlockers = getHomeExplorationBlockers(room, room ? room.memory : null, settings);
    if(homeBlockers.length) {
        return {
            request: null,
            reasons: homeBlockers
        };
    }

    var rooms = getActiveRemoteRooms(room);
    if(!rooms.length) {
        return {
            request: getScoutSpawnRequest(room),
            reasons: ['no active eligible remote rooms']
        };
    }

    var haulerDecision = getRemoteHaulerSpawnDecision(room, settings, rooms);
    if(haulerDecision) {
        return haulerDecision;
    }

    for(var i = 0; i < rooms.length; i++) {
        var remote = rooms[i];
        var sourceIds = remote.memory.sourceIds || [];
        var readyMinerSources = countReadyRemoteMinerSources(sourceIds);
        var desiredMinerSlots = countRemoteMinerSlots(sourceIds, remote.memory);
        var energy = getRemoteEnergyAmount(remote.name);
        var haulerNeed = getRemoteHaulerNeed(room, remote, settings);
        var desiredHaulers = haulerNeed ?
            haulerNeed.desiredHaulers :
            getDesiredRemoteHaulers(remote.name, sourceIds, remote.memory, energy);
        var haulers = haulerNeed ?
            haulerNeed.haulers :
            countRemoteCreeps(null, 'remoteHauler', remote.name);

        if(needsRemoteScout(room, remote.name, remote.memory, settings)) {
            reasons.push(remote.name + ': remote miner discovery pending');
            continue;
        }

        if(needsClaimBootstrap(room, remote.name)) {
            if(countRemoteCreeps(null, 'builder', remote.name) === 0) {
                return {
                    request: makeBootstrapBuilderSpawnRequest(room.name, remote.name),
                    reasons: [],
                    detail: remote.name + ': bootstrap builder needed for spawn site'
                };
            }

            reasons.push(remote.name + ': bootstrap builder already assigned');
            continue;
        }

        if(needsRemoteClaim(room, remote.name, remote.memory, settings)) {
            if(countRemoteCreeps(null, 'claimer', remote.name) === 0) {
                return {
                    request: makeClaimerSpawnRequest(room.name, remote.name),
                    reasons: [],
                    detail: remote.name + ': claim slot available at GCL ' + Game.gcl.level
                };
            }

            reasons.push(remote.name + ': claimer already assigned');
            continue;
        }

        if(!isRemoteOpenForWork(room, remote.name, remote.memory, settings)) {
            reasons.push(remote.name + ': waiting for workable remote room');
            continue;
        }

        var pendingMiners = countUnassignedRemoteMiners(remote.name);
        var pendingSourceMiners = {
            count: pendingMiners
        };

        for(var bootstrapIndex = 0; bootstrapIndex < sourceIds.length; bootstrapIndex++) {
            var bootstrapSourceId = sourceIds[bootstrapIndex];
            if(getRemoteMinerCountForSource(remote.name, bootstrapSourceId, pendingSourceMiners) < 1) {
                return {
                    request: makeRemoteSpawnRequest(room.name, remote.name, bootstrapSourceId),
                    reasons: [],
                    detail: remote.name + ': bootstrap miner needed for source ' + bootstrapSourceId
                };
            }
        }

        var missingMiner = false;
        var pendingSlotMiners = {
            count: pendingSourceMiners.count
        };
        for(var sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex++) {
            var sourceCapacity = getRemoteSourceHarvestCapacity(remote.memory, sourceIds[sourceIndex]);
            var effectiveSourceMiners = getRemoteMinerSlotCountForSource(
                remote.name,
                sourceIds[sourceIndex],
                sourceCapacity,
                pendingSlotMiners
            );

            if(effectiveSourceMiners < sourceCapacity) {
                missingMiner = true;
                return {
                    request: makeRemoteSpawnRequest(room.name, remote.name, sourceIds[sourceIndex]),
                    reasons: [],
                    detail: remote.name + ': miners ' + effectiveSourceMiners + '/' + sourceCapacity +
                        ' for source ' + sourceIds[sourceIndex]
                };
            }
        }

        var roomReasons = [];
        if(!missingMiner) {
            roomReasons.push('all source miner slots assigned (' + desiredMinerSlots + ')');
        }

        if(desiredHaulers === 0) {
            roomReasons.push('waiting for miner container build');
        }
        else if(energy < settings.minHaulEnergy) {
            roomReasons.push('remote energy ' + energy + ' < minHaulEnergy ' + settings.minHaulEnergy);
        }
        else {
            roomReasons.push('remoteHaulers assigned ' + haulers + '/' + desiredHaulers);
        }

        if(needsRemoteReservation(room, remote.name, remote.memory, settings)) {
            var workersReadyForReservation = sourceIds.length > 0 &&
                readyMinerSources > 0 &&
                haulers >= desiredHaulers;

            if(workersReadyForReservation) {
                if(countRemoteCreeps(null, 'reserver', remote.name) === 0) {
                    return {
                        request: makeReserverSpawnRequest(room.name, remote.name),
                        reasons: [],
                        detail: remote.name + ': reservation ' + getEstimatedReservationTicks(remote.memory) +
                            ' < reserveRenewBelow ' + settings.reserveRenewBelow
                    };
                }

                roomReasons.push('reserver already assigned');
            }
            else {
                roomReasons.push('waiting for remote miners/haulers before reserver');
            }
        }

        reasons.push(remote.name + ': ' + roomReasons.join('; '));
    }

    var scoutRequest = getScoutSpawnRequest(room);
    if(scoutRequest) { return {request: scoutRequest, reasons: [], detail: 'dedicated reconnaissance'}; }

    return {
        request: null,
        reasons: reasons.length ? reasons : ['no remote spawn need found']
    };
}

function getSpawnRequest(room) {
    var settings = updateRemoteMemory(room);
    return getRemoteSpawnDecision(room, settings).request;
}

function getSpawnManagerState(room, spawnManager) {
    if(!room ||
        !spawnManager ||
        !spawnManager.countRoles ||
        !spawnManager.getTargets ||
        !spawnManager.getSpawnRole) {
        return null;
    }

    var counts = spawnManager.countRoles(room);
    var targets = spawnManager.getTargets(room, counts);
    var localRole = spawnManager.getSpawnRole(counts, targets);

    return {
        counts: counts,
        targets: targets,
        localRole: localRole
    };
}

function getSpawnAvailabilityBlocker(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(!spawns.length) {
        return 'no owned spawn';
    }

    for(var i = 0; i < spawns.length; i++) {
        if(!spawns[i].spawning) {
            return null;
        }
    }

    return 'all spawns busy';
}

function getRemoteSpawnReportLine(room, settings, spawnManager) {
    if(!room) {
        return 'remote spawn blockedBy=home room not visible';
    }

    var spawnState = getSpawnManagerState(room, spawnManager);
    var spawnBlockers = [];
    var availabilityBlocker = getSpawnAvailabilityBlocker(room);
    if(availabilityBlocker) {
        spawnBlockers.push(availabilityBlocker);
    }

    if(spawnState && spawnState.localRole) {
        spawnBlockers.push(
            'local spawn priority ' +
            spawnState.localRole + ' ' +
            spawnState.counts[spawnState.localRole] + '/' +
            spawnState.targets[spawnState.localRole]
        );
    }

    if(spawnBlockers.length) {
        return 'remote spawn blockedBy=' + spawnBlockers.join(', ');
    }

    var decision = getRemoteSpawnDecision(room, settings);
    if(!decision.request) {
        return 'remote spawn blockedBy=' + decision.reasons.join(', ');
    }

    var line = 'remote spawn next=' + decision.request.role +
        ' -> ' + decision.request.memory.targetRoom;
    if(decision.request.bodyType &&
        decision.request.bodyType != decision.request.role) {
        line += ' body=' + decision.request.bodyType;
    }

    if(decision.request.memory.sourceId) {
        line += ' source=' + decision.request.memory.sourceId;
    }

    if(spawnState &&
        spawnManager &&
        spawnManager.getSpawnBodyDecision) {
        var bodyDecision = spawnManager.getSpawnBodyDecision(
            room,
            decision.request.role,
            decision.request.bodyType,
            spawnState.counts,
            spawnState.targets
        );

        if(bodyDecision.body) {
            line += ' readyEnergy=' + bodyDecision.desiredCost + '/' + room.energyCapacityAvailable;
        }
        else {
            line += ' waitingEnergy=' + room.energyAvailable + '/' + bodyDecision.desiredCost;
        }
    }

    if(decision.detail) {
        line += ' reason=' + decision.detail;
    }

    return line;
}

function findDeliveryTargetInRoom(creep, room, structureTypes) {
    var targets = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structureTypes.indexOf(structure.structureType) >= 0 &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    return getClosestByApproxRange(creep.pos, targets);
}

function findTowerDeliveryTargetInRoom(creep, room) {
    var towers = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                (!structure.isActive || structure.isActive()) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                structure.store[RESOURCE_ENERGY] < Math.min(600, structure.store.getCapacity(RESOURCE_ENERGY));
        }
    });

    return getClosestByApproxRange(creep.pos, towers);
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

function findControllerContainerDeliveryTargetInRoom(creep, room) {
    var containers = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return isControllerContainer(structure) &&
                structure.store &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    return getClosestByApproxRange(creep.pos, containers);
}

function findClosestDeliveryTarget(creep, finder) {
    var rooms = getOwnedRooms();
    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < rooms.length; i++) {
        var target = finder(rooms[i]);
        if(!target) {
            continue;
        }

        var score = getApproxRange(creep.pos, target.pos);
        if(score < bestScore) {
            best = target;
            bestScore = score;
        }
    }

    return best;
}

function findHomeDeliveryTarget(creep) {
    return findClosestDeliveryTarget(creep, function(room) {
        return findDeliveryTargetInRoom(creep, room, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]);
    }) ||
        findClosestDeliveryTarget(creep, function(room) {
            return findTowerDeliveryTargetInRoom(creep, room);
        }) ||
        findClosestDeliveryTarget(creep, function(room) {
            return findControllerContainerDeliveryTargetInRoom(creep, room);
        }) ||
        findClosestDeliveryTarget(creep, function(room) {
            return findDeliveryTargetInRoom(creep, room, [STRUCTURE_STORAGE, STRUCTURE_TERMINAL]);
        });
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
    if(!targetRoomName) {
        return;
    }

    var ownedRooms = getOwnedRooms();
    for(var i = 0; i < ownedRooms.length; i++) {
        var settings = getSettings(ownedRooms[i]);
        if(!settings.rooms[targetRoomName]) {
            if(ownedRooms[i].name != homeRoomName) {
                continue;
            }

            settings.rooms[targetRoomName] = {};
        }

        rememberUnsafeRemote(settings, settings.rooms[targetRoomName], targetRoomName, reason);
    }

    if(homeRoom && (!Memory.remote || !Memory.remote.unsafeRooms || !Memory.remote.unsafeRooms[targetRoomName])) {
        var homeSettings = getSettings(homeRoom);
        if(!homeSettings.rooms[targetRoomName]) {
            homeSettings.rooms[targetRoomName] = {};
        }

        var mem = homeSettings.rooms[targetRoomName];
        rememberUnsafeRemote(homeSettings, mem, targetRoomName, reason);
    }
}

function moveHome(creep, intent) {
    var homeFallback = getHomeFallback(creep);
    var homePos = homeFallback.pos || homeFallback;
    var travelOptions = getRemoteTravelOptions(creep.memory.homeRoom || creep.room.name, homePos.roomName);
    if(creep.room.name == homePos.roomName) { travelOptions.maxRooms = 1; }
    creepUtils.moveTo(
        creep,
        homeFallback,
        '#ff66cc',
        intent || 'home',
        'move:' + (intent || 'remoteHome'),
        travelOptions
    );
    return true;
}

function findRemoteEnergyTarget(creep, homeRoomName, preferredRoomName) {
    var homeRoom = Game.rooms[homeRoomName || creep.memory.homeRoom || creep.room.name];
    if(!homeRoom) {
        return null;
    }

    var settings = getSettings(homeRoom);
    if(settings.enabled === false) {
        return null;
    }

    var rooms;
    if(preferredRoomName && settings.rooms && settings.rooms[preferredRoomName]) {
        rooms = [{
            name: preferredRoomName,
            memory: settings.rooms[preferredRoomName]
        }];
    }
    else {
        rooms = getActiveRemoteRooms(homeRoom);
    }

    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < rooms.length; i++) {
        var remoteRoom = Game.rooms[rooms[i].name];
        if(!remoteRoom ||
            hasThreats(remoteRoom) ||
            hasHostileTower(remoteRoom) ||
            !canHarvestRemoteRoom(remoteRoom)) {
            continue;
        }

        var containers = remoteRoom.find(FIND_STRUCTURES, {
            filter: function(structure) {
                var minimumEnergy = rooms[i].name == preferredRoomName ?
                    1 :
                    Math.min(100, creep.store.getFreeCapacity(RESOURCE_ENERGY));

                return structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store &&
                    structure.store[RESOURCE_ENERGY] >= minimumEnergy;
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
                var minimumAmount = rooms[i].name == preferredRoomName ?
                    1 :
                    Math.min(100, creep.store.getFreeCapacity(RESOURCE_ENERGY));

                return resource.resourceType == RESOURCE_ENERGY &&
                    resource.amount >= minimumAmount;
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
            creepUtils.moveTo(
                creep,
                target,
                '#ffaa00',
                'remote haul',
                'move:remotePickup',
                getRemoteTravelOptions(creep.memory.homeRoom || creep.room.name, target.pos.roomName)
            );
            return true;
        }

        if(pickupResult == OK) {
            if(creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
                creep.memory.working = true;
            }
            creepUtils.announceIntent(creep, 'action:remotePickup', 'pickup');
            return true;
        }

        return false;
    }

    var withdrawResult = creep.withdraw(target, RESOURCE_ENERGY);
    if(withdrawResult == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(
            creep,
            target,
            '#ffaa00',
            'remote haul',
            'move:remoteWithdraw',
            getRemoteTravelOptions(creep.memory.homeRoom || creep.room.name, target.pos.roomName)
        );
        return true;
    }

    if(withdrawResult == OK) {
        if(creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
            creep.memory.working = true;
        }
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
    getClaimerTarget: getClaimerTarget,
    getDiscoveryTarget: getDiscoveryTarget,
    getReserverTarget: getReserverTarget,
    getScoutTarget: getScoutTarget,
    getScoutSpawnRequest: getScoutSpawnRequest,
    failScoutTarget: failScoutTarget,
    getSettings: getSettings,
    getReport: getReport,
    getSpawnRequest: getSpawnRequest,
    getRemoteEnergyAmount: getRemoteEnergyAmount,
    hasHostileTower: hasHostileTower,
    hasThreats: hasThreats,
    areRemoteExtractionSlotsFilled: areRemoteExtractionSlotsFilled,
    getRemoteSourceHarvestCapacity: getRemoteSourceHarvestCapacity,
    isRemoteWorkable: isRemoteWorkable,
    isRemoteScoutable: isRemoteScoutable,
    isRemoteUsable: isRemoteUsable,
    canHarvestRemoteRoom: canHarvestRemoteRoom,
    markUnsafe: markUnsafe,
    moveToRoom: moveToRoom,
    moveHome: moveHome,
    run: run,
    withdrawOrPickup: withdrawOrPickup
};
