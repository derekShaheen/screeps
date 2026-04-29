var debug = require('utils.debug');
var spawnManager = require('manager.spawn');

function formatProgress(controller) {
    if(!controller || !controller.progressTotal) {
        return '0%';
    }

    return Math.floor(controller.progress / controller.progressTotal * 100) + '%';
}

function getSpawnText(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(!spawns.length) {
        return 'none';
    }

    for(var i = 0; i < spawns.length; i++) {
        if(spawns[i].spawning) {
            return spawns[i].spawning.name;
        }
    }

    return 'idle';
}

function getTowerText(room) {
    var towers = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER;
        }
    });

    if(!towers.length) {
        return '0';
    }

    var energy = 0;
    var capacity = 0;
    for(var i = 0; i < towers.length; i++) {
        energy += towers[i].store[RESOURCE_ENERGY];
        capacity += towers[i].store.getCapacity(RESOURCE_ENERGY);
    }

    return towers.length + ' | ' + energy + '/' + capacity;
}

var uiManager = {
    run: function(room) {
        if(!debug.enabled('debugVisuals')) {
            return;
        }

        var counts = spawnManager.countRoles(room);
        var targets = spawnManager.getTargets(room, counts);
        var hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        var sites = room.find(FIND_CONSTRUCTION_SITES).length;
        var controller = room.controller;
        var rcl = controller ? controller.level : 0;
        var wallTarget = room.memory.wallTargetHits || 1000;

        var lines = [
            '[Startup AI]',
            'Energy: ' + room.energyAvailable + ' / ' + room.energyCapacityAvailable,
            'RCL: ' + rcl + ' | ' + formatProgress(controller),
            'Creeps: H ' + counts.harvester + '/' + targets.harvester +
                ' | B ' + counts.builder + '/' + targets.builder +
                ' | U ' + counts.upgrader + '/' + targets.upgrader,
            'Spawn: ' + getSpawnText(room),
            'Hostiles: ' + hostiles,
            'Towers: ' + getTowerText(room),
            'Walls: target ' + wallTarget,
            'Sites: ' + sites
        ];

        var x = 1;
        var y = 1;
        room.visual.rect(x - 0.4, y - 0.8, 16.4, lines.length + 0.3, {
            fill: '#111111',
            opacity: 0.35,
            stroke: '#66ccff',
            strokeWidth: 0.05
        });

        for(var i = 0; i < lines.length; i++) {
            room.visual.text(lines[i], x, y + i, {
                align: 'left',
                color: '#ffffff',
                font: i === 0 ? 0.8 : 0.65,
                opacity: 0.9
            });
        }
    }
};

module.exports = uiManager;
