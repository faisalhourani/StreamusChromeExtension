//  A singleton representing the sole logged on user for the program.
//  Tries to load itself by ID stored in localStorage and then by chrome.storage.sync.
//  If still unloaded, tells the server to create a new user and assumes that identiy.
var User = null;
define([
    'folders',
    'settings'
], function (Folders, Settings) {
    'use strict';

    var syncUserIdKey = 'UserId';

    //  User data will be loaded either from cache or server.
    var userModel = Backbone.Model.extend({
        defaults: function() {
            return {
                id: null,
                name: '',
                dirty: false,
                loaded: false,
                folders: new Folders()
            };
        },
        
        //  TODO: I feel like some of the work should've been done in parse and not onUserLoaded...

        urlRoot: Settings.get('serverURL') + 'User/',

        initialize: function () {
            
            chrome.storage.sync.set({
                'dirty': false
            });
            
            var self = this;
            
            //  changes: Object mapping each key that changed to its corresponding StorageChange for that item.
            //  areaName: The name of the storage area (sync or local) the changes are for.
            chrome.storage.onChanged.addListener(function (changes, areaName) {

                if (areaName === 'sync') {
                    var dirtyChange = changes['dirty'];
                    console.log('Dirty changed:', dirtyChange.newValue);
                    self.set('dirty', dirtyChange.newValue, { silent: true });
                }

            });
            
            //  TODO: Consider rate limiting this if >1000 saves occur in an hour?
            this.on('change:dirty', function (model, dirty) {
                console.log("setting dirty", dirty);

                chrome.storage.sync.set({
                    'dirty': dirty
                });
            });

            //  chrome.Storage.sync is cross-computer syncing with restricted read/write amounts.
            chrome.storage.sync.get(syncUserIdKey, function (data) {
                //  Look for a user id in sync, it might be undefined though.
                var foundUserId = data[syncUserIdKey];

                if (typeof foundUserId === 'undefined') {

                    foundUserId = Settings.get('userId');
                    
                    if (foundUserId !== null) {
                        self.set('id', foundUserId);
                        fetchUser.call(self, true);
                    } else {
                        
                        //  No stored ID found at any client storage spot. Create a new user and use the returned user object.
                        self.save({}, {
                            success: function (model) {
                                onUserLoaded.call(self, model, true);
                            },
                            error: function (error) {
                                console.error(error);
                            }
                        });
                    }

                } else {
                    //  Update the model's id to proper value and call fetch to retrieve all data from server.
                    self.set('id', foundUserId);
                    
                    //  Pass false due to success of fetching from chrome.storage.sync -- no need to overwrite with same data.
                    fetchUser.call(self, false);
                }
            });

            //  newState is an enum of or "active"or "idle"or "locked"
            chrome.idle.onStateChanged.addListener(function(newState) {

                console.log("newState:", newState, self.get('dirty'));

                if (newState == 'active' && self.get('dirty')) {
                    //  Pass false due to success of fetching from chrome.storage.sync -- no need to overwrite with same data.
                    fetchUser.call(self, false);
                }

            });

            //  Start watching for changes to user or any collection/model underneath it to set dirty flag.
            this.on('childSync', function (a, e, o) {
                console.log("trace", a, e, o);
                console.trace();
                this.set('dirty', true);
            });

            console.log('done with onUserloaded');
        }
    });
    
    function onUserLoaded(model, shouldSetSyncStorage) {

        console.log("inside onUserLoaded");
        var folders = this.get('folders');

        //  Need to convert folders array to Backbone.Collection
        if (!(folders instanceof Backbone.Collection)) {
            folders = new Folders(folders);
            //  Silent because folders is just being properly set.
            this.set('folders', folders, { silent: true });
            
            this.listenTo(folders, 'sync', function () {
                console.log("Triggering a sync");
                this.trigger('childSync');
            });
        }

        //  Try to load active folder from localstorage
        if (folders.length > 0) {

            var activeFolderId = localStorage.getItem(this.get('id') + '_activeFolderId');

            //  Be sure to always have an active folder if there is one available.
            var folderToSetActive = this.get('folders').get(activeFolderId) || folders.at(0);
            folderToSetActive.set('active', true);

        }

        var self = this;
        this.listenTo(folders, 'change:active', function (folder, isActive) {
            //  Keep local storage up-to-date with the active folder.
            if (isActive) {
                localStorage.setItem(self.get('id') + '_activeFolderId', folder.get('id'));
            }
        });

        //  TODO: Error handling for writing to sync too much.
        //  Write to sync as little as possible because it has restricted read/write limits per hour.
        if (shouldSetSyncStorage) {

            //  Using the bracket access notation here to leverage the variable which stores the key for chrome.storage.sync
            //  I want to be able to ensure I am getting/setting from the same location, thus the variable.
            var storedKey = {};
            storedKey[syncUserIdKey] = model.get('id');

            chrome.storage.sync.set(storedKey);
        }

        //  Announce that user has loaded so managers can use it to fetch data.
        this.set('loaded', true);
        Settings.set('userId', this.get('id'));
    }
    
    //  Loads user data by ID from the server, writes the ID
    //  to client-side storage locations for future loading and then announces
    //  that the user has been loaded fully.

    function fetchUser(shouldSetSyncStorage) {
        var self = this;

        this.set('loaded', false);
        this.fetch({
            success: function (model) {
                console.log("fetched");
                onUserLoaded.call(self, model, shouldSetSyncStorage);
            },
            error: function (error) {
                console.error(error);
            }
        });
    }

    //  Only ever instantiate one User.
    User = new userModel();
    
    return User;
});