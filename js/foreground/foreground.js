﻿//  When the foreground is loaded it will load all the ui elements. Grouped like this so I can wait for the
//  background YouTube player to load entirely before allowing foreground to open.
define([
    'settings',
    'activeFolderTabView',
    'activePlaylistTabView',
    'streamView',
    'videoDisplayView',
    'loadingSpinnerView',
    'reloadPromptView',

    'volumeControlView',
    'playPauseButtonView',
    'nextButtonView',
    'previousButtonView',
    'shuffleButtonView',
    'radioButtonView',
    'repeatButtonView',
    'progressBarView',

    'headerTitleView'
], function (Settings, ActiveFolderTabView, ActivePlaylistTabView, StreamView, VideoDisplayView, LoadingSpinnerView, ReloadPromptView) {
    'use strict';

    var ForegroundView = Backbone.View.extend({

        el: $('body'),
        
        activeFolderTabView: null,
        activePlaylistTabView: null,
        streamView: null,
        videoDisplayView: null,
        loadingSpinnerView: new LoadingSpinnerView,
        reloadPromptView: new ReloadPromptView,
        showReloadPromptTimeout: null,
        
        //  These are pulled from the background page. They'll be null until background is fully initialized.
        backgroundPlayer: chrome.extension.getBackgroundPage().YouTubePlayer,
        backgroundUser: chrome.extension.getBackgroundPage().User,

        events: {
            'click .contentButton': 'showContent'
        },

        initialize: function () {
            var self = this;

            this.$el.append(this.loadingSpinnerView.render().el);
            
            //  If the foreground hasn't properly initialized after 5 seconds offer the ability to restart the program.
            //  Background.js might have gone awry for some reason and it is not always clear how to restart Streamus via chrome://extension
            this.showReloadPromptTimeout = setTimeout(function () {
                self.$el.append(self.reloadPromptView.render().el);
            }, 5000);

            //  If the user opens the foreground SUPER FAST then requireJS won't have been able to load everything in the background in time.
            if (this.backgroundPlayer == null || this.backgroundUser == null) {

                //  TODO: Maybe just wait for a background isReady event and let the background handle this instead of polling?
                //  Poll the background until it is ready.
                var checkBackgroundLoadedInterval = setInterval(function () {

                    self.backgroundPlayer = chrome.extension.getBackgroundPage().YouTubePlayer;
                    self.backgroundUser = chrome.extension.getBackgroundPage().User;

                    if (self.backgroundPlayer != null && self.backgroundUser != null) {

                        clearInterval(checkBackgroundLoadedInterval);
                        self.waitForBackgroundUserLoaded();
                    }

                }, 100);

            } else {
                this.waitForBackgroundUserLoaded();
            }

        },

        showContent: function (event) {
            var clickedContentButton = $(event.currentTarget);
            this.setContentButtonActive(clickedContentButton);
        },
        
        setContentButtonActive: function (contentButton) {

            //  Clear content and show new content based on button clicked.
            $('.contentButton').removeClass('active');
            contentButton.addClass('active');

            Settings.set('activeContentButtonId', contentButton[0].id);
            
            $('.content').hide();

            //  TODO: Pull active from a ContentButton collection instead of analyzing the View.
            var activeContentButton = $('.contentButton.active');
            var activeContentId = activeContentButton.data('content');

            $('#' + activeContentId).show();

            //  Only render the videoDisplayView when it becomes visible to save processing power.
            if (activeContentId == 'VideoContent') {
                this.videoDisplayView.render();
            }
            else if (activeContentId == 'HomeContent') {
                this.activePlaylistTabView.activePlaylistView.$el.trigger('manualShow');
            }
        },
        
        waitForBackgroundUserLoaded: function () {

            this.listenTo(this.backgroundUser, 'change:loaded', function (model, loaded) {

                if (loaded) {
                    this.waitForBackgroundPlayerReady();
                } else {
                    //  TODO: Display a loading message while user data is refreshing.
                    console.log("user is unloaded, waiting!");
                }

            });

            //  If the foreground is opened before the background has had a chance to load, wait for the background.
            //  This is easier than having every control on the foreground guard against the background not existing.
            if (this.backgroundUser.get('loaded')) {
                this.waitForBackgroundPlayerReady();
            }

        },
        
        waitForBackgroundPlayerReady: function () {
            
            this.listenTo(this.backgroundPlayer, 'change:ready', function (model, ready) {

                if (ready) {
                    this.loadBackgroundDependentContent();
                } else {
                    console.log("BackgroundPlayer has gone unready, need to show message.");
                }

            });

            if (this.backgroundPlayer.get('ready')) {
                //  Load foreground when the background indicates it has loaded.
                this.loadBackgroundDependentContent();
            }
        },

        loadBackgroundDependentContent: function () {

            this.$el.removeClass('loading');
            clearTimeout(this.showReloadPromptTimeout);
            this.reloadPromptView.remove();
            this.loadingSpinnerView.remove();

            var activeFolder = this.backgroundUser.get('folders').getActiveFolder();

            //  TODO: Instead of calling changeModel I should be removing/recreating my views I think.
            if (this.activeFolderTabView === null) {
                this.activeFolderTabView = new ActiveFolderTabView({
                    model: activeFolder
                });
            } else {
                this.activeFolderTabView.changeModel(activeFolder);
            }

            if (this.activePlaylistTabView === null) {
                this.activePlaylistTabView = new ActivePlaylistTabView({
                    model: activeFolder.getActivePlaylist()
                });
            } else {
                this.activePlaylistTabView.changeModel(activeFolder.getActivePlaylist());
            }
            
            if (this.streamView === null) {

                this.streamView = new StreamView({
                    model: activeFolder
                });

            } else {
                this.streamView.changeModel(activeFolder);
            }
            
            //  VideoDisplayView properly uses a template so I can just remove and re-create it I believe.
            if (this.videoDisplayView) {
                this.videoDisplayView.remove();
            }
            this.videoDisplayView = new VideoDisplayView;

            var folders = this.backgroundUser.get('folders');

            this.listenTo(folders, 'change:active', function (folder, isActive) {

                //  TODO: Instead of calling changeModel, I would like to remove the view and re-add it.
                if (isActive) {
                    this.activeFolderTabView.changeModel(folder);
                    this.streamView.changeModel(activeFolder);
                }

            });

            //  TODO: if activeFolder changes I think I'll need to unbind and rebind
            var playlists = folders.getActiveFolder().get('playlists');
            this.listenTo(playlists, 'change:active', function (playlist, isActive) {

                //  TODO: Instead of calling changeModel, I would like to remove the view and re-add it.
                if (isActive) {
                    this.activePlaylistTabView.changeModel(playlist);
                }

            });

            //  Set the initially loaded content to whatever was clicked last or the home page as a default
            //  TODO: Remove the string replace in a few versions, I changed localStorage names and need to support old versions for a while.
            var activeContentButtonId = Settings.get('activeContentButtonId').replace('Menu', 'Content');
            var activeContentButton = $('#' + activeContentButtonId);

            console.log("activeContentButtonId", activeContentButtonId);

            this.setContentButtonActive(activeContentButton);
            this.$el.find('#VideoContent').append(this.videoDisplayView.render().el);

        },

    });

    return new ForegroundView;
});