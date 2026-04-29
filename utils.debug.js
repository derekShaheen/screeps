var DEFAULT_SETTINGS = {
    debug: true,
    debugRoles: true,
    debugSpawn: true,
    debugDefense: true,
    debugVisuals: true,
    debugPaths: true,
    debugInterval: 5
};

function getSettings() {
    if(!Memory.settings) {
        Memory.settings = {};
    }

    for(var key in DEFAULT_SETTINGS) {
        if(Memory.settings[key] === undefined) {
            Memory.settings[key] = DEFAULT_SETTINGS[key];
        }
    }

    return Memory.settings;
}

function isEnabled(flag) {
    var settings = getSettings();
    return !!settings.debug && !!settings[flag];
}

var debug = {
    initialize: function() {
        getSettings();
    },

    enabled: function(flag) {
        return isEnabled(flag);
    },

    log: function(flag, message, interval) {
        if(!isEnabled(flag)) {
            return;
        }

        var settings = getSettings();
        var every = interval === undefined ? settings.debugInterval : interval;
        if(every > 1 && Game.time % every !== 0) {
            return;
        }

        console.log('[StartupAI][' + flag + '] ' + message);
    },

    roleState: function(creep, state) {
        this.log('debugRoles', creep.name + ' -> ' + state + ' in ' + creep.room.name, 1);
    }
};

module.exports = debug;
