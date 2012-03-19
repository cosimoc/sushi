/*
 * Copyright (C) 2011 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA
 * 02111-1307, USA.
 *
 * The Sushi project hereby grant permission for non-gpl compatible GStreamer
 * plugins to be used and distributed together with GStreamer and Sushi. This
 * permission is above and beyond the permissions granted by the GPL license
 * Sushi is covered by.
 *
 * Authors: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gdk = imports.gi.Gdk;
const GdkX11 = imports.gi.GdkX11;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gtk = imports.gi.Gtk;
const GtkClutter = imports.gi.GtkClutter;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;

const Cairo = imports.cairo;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;

const Mainloop = imports.mainloop;

const MimeHandler = imports.ui.mimeHandler;
const Constants = imports.util.constants;
const SpinnerBox = imports.ui.spinnerBox;

const Sushi = imports.gi.Sushi;

function MainWindow(args) {
    this._init(args);
}

MainWindow.prototype = {
    _init : function(args) {
        args = args || {};

        this._mimeHandler = new MimeHandler.MimeHandler();

        this._application = args.application;
        this._createGtkWindow();
        this._createClutterEmbed();

        this._connectStageSignals();
	this.file = null;
    },

    _createGtkWindow : function() {
        this._gtkWindow = new Gtk.Window({ type: Gtk.WindowType.TOPLEVEL,
                                           focusOnMap: true,
                                           decorated: false,
                                           hasResizeGrip: false,
                                           skipPagerHint: true,
                                           skipTaskbarHint: true,
                                           windowPosition: Gtk.WindowPosition.CENTER,
                                           gravity: Gdk.Gravity.CENTER });

        let screen = Gdk.Screen.get_default();
        this._gtkWindow.set_visual(screen.get_rgba_visual());

        this._gtkWindow.connect("delete-event",
                                Lang.bind(this, this._onWindowDeleteEvent));
    },

    _createClutterEmbed : function() {
        this._clutterEmbed = new GtkClutter.Embed();
        this._gtkWindow.add(this._clutterEmbed);

        this._clutterEmbed.set_receives_default(true);
        this._clutterEmbed.set_can_default(true);

        this._stage = this._clutterEmbed.get_stage();
        this._stage.set_use_alpha(true);
        this._stage.set_opacity(0);
        this._stage.set_color(new Clutter.Color({ red: 0,
                                                  green: 0,
                                                  blue: 0,
                                                  alpha: 255 }));
        this._mainGroup =  new Clutter.Group();
        this._stage.add_actor(this._mainGroup);
        this._mainGroup.set_opacity(0);
    },

    _connectStageSignals : function() {
        this._stage.connect("key-press-event",
                            Lang.bind(this, this._onStageKeyPressEvent));
        this._stage.connect("button-press-event",
                            Lang.bind(this, this._onButtonPressEvent));
        this._stage.connect("motion-event",
                            Lang.bind(this, this._onMotionEvent));
    },

    _createSolidBackground: function() {
        if (this._background)
            return;

        this._background = new Clutter.Rectangle();
        this._background.set_opacity(255);
        this._background.set_color(new Clutter.Color({ red: 0,
                                                       green: 0,
                                                       blue: 0,
                                                       alpha: 255 }));
        this._background.add_constraint(
            new Clutter.BindConstraint({ source: this._stage,
                                         coordinate: Clutter.BindCoordinate.POSITION }));
        this._background.add_constraint(
            new Clutter.BindConstraint({ source: this._stage,
                                         coordinate: Clutter.BindCoordinate.SIZE }));

        this._mainGroup.add_actor(this._background);
        this._background.lower_bottom();
    },

    _createAlphaBackground: function() {
        if (this._background)
            return;

        this._background = Sushi.create_rounded_background();
        this._background.set_opacity(Constants.VIEW_BACKGROUND_OPACITY);
        this._background.add_constraint(
            new Clutter.BindConstraint({ source: this._stage,
                                         coordinate: Clutter.BindCoordinate.POSITION }));
        this._background.add_constraint(
            new Clutter.BindConstraint({ source: this._stage,
                                         coordinate: Clutter.BindCoordinate.SIZE }));

        this._mainGroup.add_actor(this._background);
        this._background.lower_bottom();
    },

    /**************************************************************************
     ****************** main object event callbacks ***************************
     **************************************************************************/
    _onWindowDeleteEvent : function() {
        this._clearAndQuit();
    },

    _onStageKeyPressEvent : function(actor, event) {
        let key = event.get_key_symbol();

        if (key == Clutter.KEY_Escape ||
            key == Clutter.KEY_space ||
            key == Clutter.KEY_q)
            this._fadeOutWindow();

        if (key == Clutter.KEY_f ||
            key == Clutter.KEY_F11)
            this.toggleFullScreen();
    },

    _onButtonPressEvent : function(actor, event) {
        let win_coords = event.get_coords();

        if ((event.get_source() == this._toolbarActor) ||
            (event.get_source() == this._quitActor) ||
            (event.get_source() == this._texture &&
             !this._renderer.moveOnClick)) {

            if (event.get_source() == this._toolbarActor)
                this._resetToolbar();

            return false;
        }

        let root_coords = 
            this._gtkWindow.get_window().get_root_coords(win_coords[0],
                                                         win_coords[1]);

        this._gtkWindow.begin_move_drag(event.get_button(),
                                        root_coords[0],
                                        root_coords[1],
                                        event.get_time());

        return false;
    },

    _onMotionEvent : function() {
        if (this._toolbarActor)
            this._resetToolbar();

        return false;
    },

    /**************************************************************************
     *********************** texture allocation *******************************
     **************************************************************************/
    _getTextureSize : function() {
        let screenSize = [ this._gtkWindow.get_window().get_width(),
                           this._gtkWindow.get_window().get_height() ];

        let availableWidth = this._isFullScreen ? screenSize[0] : Constants.VIEW_MAX_W - 2 * Constants.VIEW_PADDING_X;
        let availableHeight = this._isFullScreen ? screenSize[1] : Constants.VIEW_MAX_H - Constants.VIEW_PADDING_Y;

        let textureSize = this._renderer.getSizeForAllocation([availableWidth, availableHeight], this._isFullScreen);

        return textureSize;
    },

    _getWindowSize : function() {
        let textureSize = this._getTextureSize();
        let windowSize = textureSize;

        if (textureSize[0] < (Constants.VIEW_MIN - 2 * Constants.VIEW_PADDING_X) &&
            textureSize[1] < (Constants.VIEW_MIN - Constants.VIEW_PADDING_Y)) {
            windowSize = [ Constants.VIEW_MIN, Constants.VIEW_MIN ];
        } else if (!this._isFullScreen) {
            windowSize = [ windowSize[0] + 2 * Constants.VIEW_PADDING_X,
                           windowSize[1] + Constants.VIEW_PADDING_Y ];
        }

        return windowSize;
    },

    _positionTexture : function() {
        let yFactor = 0;

        let textureSize = this._getTextureSize();
        let windowSize = this._getWindowSize();

        if (textureSize[0] < Constants.VIEW_MIN &&
            textureSize[1] < Constants.VIEW_MIN) {
            yFactor = 0.52;
        }

        if (yFactor == 0) {
            if (this._isFullScreen && 
               (textureSize[0] > textureSize[1]))
                yFactor = 0.52;
            else
                yFactor = 0.92;
        }

        this._texture.set_size(textureSize[0], textureSize[1]);
        this._textureYAlign.factor = yFactor;

        if (this._lastWindowSize &&
            windowSize[0] == this._lastWindowSize[0] &&
            windowSize[1] == this._lastWindowSize[1])
            return;

        this._lastWindowSize = windowSize;

        if (!this._isFullScreen) {
            this._gtkWindow.resize(windowSize[0], windowSize[1]);
        }
    },

    _createRenderer : function(file) {
        if (this._renderer) {
            if (this._renderer.clear)
                this._renderer.clear();

            delete this._renderer;
        }

        /* create a temporary spinner renderer, that will timeout and show itself
         * if the loading takes too long.
         */
        this._renderer = new SpinnerBox.SpinnerBox();
        this._renderer.startTimeout();

        file.query_info_async
        (Gio.FILE_ATTRIBUTE_STANDARD_DISPLAY_NAME + "," +
         Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
         Gio.FileQueryInfoFlags.NONE,
         GLib.PRIORITY_DEFAULT, null,
         Lang.bind (this,
                    function(obj, res) {
                        try {
                            this._fileInfo = obj.query_info_finish(res);
                            this.setTitle(this._fileInfo.get_display_name());

                            /* now prepare the real renderer */
                            this._pendingRenderer = this._mimeHandler.getObject(this._fileInfo.get_content_type());
                            this._pendingRenderer.prepare(file, this, Lang.bind(this, this._onRendererPrepared));
                        } catch(e) {
                            /* FIXME: report the error */
                        }}));
    },

    _onRendererPrepared : function() {
        /* destroy the spinner renderer */
        this._renderer.destroy();

        this._renderer = this._pendingRenderer;
        delete this._pendingRenderer;

        /* generate the texture and toolbar for the new renderer */
        this._createTexture();
        this._createToolbar();
    },

    _createTexture : function() {
        if (this._texture) {
            this._texture.destroy();
            delete this._texture;
        }

        this._texture = this._renderer.render();

        this._textureXAlign = 
            new Clutter.AlignConstraint({ source: this._stage,
                                          factor: 0.5 });
        this._textureYAlign =
            new Clutter.AlignConstraint({ source: this._stage,
                                          factor: 0.5,
                                          "align-axis": Clutter.AlignAxis.Y_AXIS })

        this._texture.add_constraint(this._textureXAlign);
        this._texture.add_constraint(this._textureYAlign);

        this.refreshSize();
        this._mainGroup.add_actor(this._texture);
    },

    /**************************************************************************
     ************************** fullscreen ************************************
     **************************************************************************/
    _onStageUnFullScreen : function() {
        this._stage.disconnect(this._unFullScreenId);
        delete this._unFullScreenId;

	/* We want the alpha background back now */
        this._background.destroy();
        delete this._background;
        this._createAlphaBackground();

        this._textureYAlign.factor = this._savedYFactor;

        let textureSize = this._getTextureSize();
        this._texture.set_size(textureSize[0],
                               textureSize[1]);

        Tweener.addTween(this._mainGroup,
                         { opacity: 255,
                           time: 0.15,
                           transition: 'easeOutQuad',
                         });
        Tweener.addTween(this._titleGroup,
                         { opacity: 255,
                           time: 0.15,
                           transition: 'easeOutQuad',
                         });
    },

    _exitFullScreen : function() {
        this._isFullScreen = false;

        if (this._toolbarActor) {
            this._toolbarActor.set_opacity(0);
            this._removeToolbarTimeout();
        }

        /* wait for the next stage allocation to fade in the texture 
         * and background again.
         */
        this._unFullScreenId =
            this._stage.connect("notify::allocation",
                                Lang.bind(this, this._onStageUnFullScreen));

        /* quickly fade out everything,
         * and then unfullscreen the (empty) window.
         */
        Tweener.addTween(this._mainGroup,
                         { opacity: 0,
                           time: 0.10,
                           transition: 'easeOutQuad',
                           onComplete: function() {
                               this._gtkWindow.unfullscreen();
                           },
                           onCompleteScope: this
                         });
    },

    _onStageFullScreen : function() {
        this._stage.disconnect(this._fullScreenId);
        delete this._fullScreenId;

        /* We want a solid black background */
        this._background.destroy();
        delete this._background;
	this._createSolidBackground();

	/* Fade in everything but the title */
        Tweener.addTween(this._mainGroup,
                         { opacity: 255,
                           time: 0.15,
                           transition: 'easeOutQuad'
                         });

        /* zoom in the texture now */
        this._savedYFactor = this._textureYAlign.factor;
        let yFactor = this._savedFactor;

        if (this._texture.width > this._texture.height)
            yFactor = 0.52;
        else
            yFactor = 0.92;

        let textureSize = this._getTextureSize();

        Tweener.addTween(this._texture,
                         { width: textureSize[0],
                           height: textureSize[1],
                           time: 0.15,
                           transition: 'easeOutQuad'
                         });

        Tweener.addTween(this._textureYAlign,
                         { factor: yFactor,
                           time: 0.15,
                           transition: 'easeOutQuad'
                         });
    },

    _enterFullScreen : function() {
        this._isFullScreen = true;

        if (this._toolbarActor) {
            /* prepare the toolbar */
            this._toolbarActor.set_opacity(0);
            this._removeToolbarTimeout();
        }

        /* wait for the next stage allocation to fade in the texture 
         * and background again.
         */
        this._fullScreenId =
            this._stage.connect("notify::allocation",
                                Lang.bind(this, this._onStageFullScreen));

        /* quickly fade out everything,
         * and then fullscreen the (empty) window.
         */
        Tweener.addTween(this._titleGroup,
                         { opacity: 0,
                           time: 0.10,
                           transition: 'easeOutQuad'
                         });
        Tweener.addTween(this._mainGroup,
                         { opacity: 0,
                           time: 0.10,
                           transition: 'easeOutQuad',
                           onComplete: function () {
                               this._gtkWindow.fullscreen();
                           },
                           onCompleteScope: this
                         });
    },

    /**************************************************************************
     ************************* toolbar helpers ********************************
     **************************************************************************/
    _createToolbar : function() {
        if (this._toolbarActor) {
            this._toolbarActor.destroy();
            delete this._toolbarActor;
        }

        if (this._renderer.createToolbar)
            this._toolbarActor = this._renderer.createToolbar();

        if (!this._toolbarActor)
            return;

        this._toolbarActor.set_reactive(true);
        this._toolbarActor.set_opacity(0);
        this._mainGroup.add_actor(this._toolbarActor);

        this._toolbarActor.add_constraint(
            new Clutter.AlignConstraint({ source: this._stage,
                                          factor: 0.5 }));

        let yConstraint = 
            new Clutter.BindConstraint({ source: this._stage,
                                         coordinate: Clutter.BindCoordinate.Y,
                                         offset: this._stage.height - Constants.TOOLBAR_SPACING });
        this._toolbarActor.add_constraint(yConstraint);

        this._stage.connect("notify::height",
                            Lang.bind(this, function() {
                                yConstraint.set_offset(this._stage.height - Constants.TOOLBAR_SPACING);
                            }));
    },

    _removeToolbarTimeout: function() {
        Mainloop.source_remove(this._toolbarId);
        delete this._toolbarId;
    },

    _resetToolbar : function() {
        if (this._toolbarId) {
            this._removeToolbarTimeout();
        } else {
            Tweener.removeTweens(this._toolbarActor);

            this._toolbarActor.raise_top();
            this._toolbarActor.set_opacity(0);

            Tweener.addTween(this._toolbarActor,
                             { opacity: 200,
                               time: 0.1,
                               transition: 'easeOutQuad',
                             });
        }

        this._toolbarId = Mainloop.timeout_add(1500,
                                               Lang.bind(this,
                                                         this._onToolbarTimeout));
    },

    _onToolbarTimeout : function() {
        delete this._toolbarId;
        Tweener.addTween(this._toolbarActor,
                         { opacity: 0,
                           time: 0.25,
                           transition: 'easeOutQuad'
                         });
        return false;
    },


    /**************************************************************************
     ************************ titlebar helpers ********************************
     **************************************************************************/
    _createTitle : function() {
        if (this._titleGroup) {
            this._titleGroup.raise_top();
            return;
        }

        this._titleGroupLayout = new Clutter.BoxLayout();
        this._titleGroup =  new Clutter.Box({ layout_manager: this._titleGroupLayout,
                                              opacity: 0 });
        this._stage.add_actor(this._titleGroup);

        this._titleGroup.add_constraint(
            new Clutter.BindConstraint({ source: this._stage,
                                         coordinate: Clutter.BindCoordinate.WIDTH }));

        this._titleLabel = new Gtk.Label({ label: "",
					   ellipsize: Pango.EllipsizeMode.END,
                                           margin: 6 });
        this._titleLabel.get_style_context().add_class("np-decoration");
        
        this._titleLabel.show();
        this._titleActor = new GtkClutter.Actor({ contents: this._titleLabel });

        this._quitButton = 
            new Gtk.Button({ image: new Gtk.Image ({ "icon-size": Gtk.IconSize.MENU,
                                                     "icon-name": "window-close-symbolic" })});
        this._quitButton.get_style_context().add_class("np-decoration");
        this._quitButton.show();

        this._quitButton.connect("clicked",
                                 Lang.bind(this,
                                           this._clearAndQuit));

        this._quitActor = new GtkClutter.Actor({ contents: this._quitButton });
        this._quitActor.set_reactive(true);

        let hidden = new Clutter.Actor();
        let size = this._quitButton.get_preferred_size()[1];
        hidden.set_size(size.width, size.height);

        this._titleGroupLayout.pack(hidden, false, false, false,
                                    Clutter.BoxAlignment.START, Clutter.BoxAlignment.START);
        this._titleGroupLayout.pack(this._titleActor, true, true, false,
                                    Clutter.BoxAlignment.CENTER, Clutter.BoxAlignment.START);
        this._titleGroupLayout.pack(this._quitActor, false, false, false,
                                    Clutter.BoxAlignment.END, Clutter.BoxAlignment.START);
    },

    /**************************************************************************
     *********************** Window move/fade helpers *************************
     **************************************************************************/
    _fadeInWindow : function() {
        this._mainGroup.set_opacity(0);
        this._titleGroup.set_opacity(0);

        this._gtkWindow.show_all();

        Tweener.addTween(this._mainGroup,
                         { opacity: 255,
                           time: 0.3,
                           transition: 'easeOutQuad' });
        Tweener.addTween(this._titleGroup,
                         { opacity: 255,
                           time: 0.3,
                           transition: 'easeOutQuad' });
    },

    _fadeOutWindow : function() {
        if (this._toolbarId) {
            this._removeToolbarTimeout();
        }

        Tweener.addTween(this._titleGroup,
                         { opacity: 0,
                           time: 0.15,
                           transition: 'easeOutQuad',
                         });

        Tweener.addTween(this._mainGroup,
                         { opacity: 0,
                           time: 0.15,
                           transition: 'easeOutQuad',
                           onComplete: function () {
                               this._clearAndQuit();
                           },
                           onCompleteScope: this
                         });
    },

    _clearAndQuit : function() {
        if (this._renderer.clear)
            this._renderer.clear();

        this._application.quit();
    },

    /**************************************************************************
     ************************ public methods **********************************
     **************************************************************************/
    setParent : function(xid) {
        this._parent = Sushi.create_foreign_window(xid);
        this._gtkWindow.realize();
        this._gtkWindow.get_window().set_transient_for(this._parent);
        this._gtkWindow.show_all();
    },

    setFile : function(file) {
	this.file = file;
        this._createAlphaBackground();
        this._createRenderer(file);
        this._createTexture();
        this._createToolbar();
        this._createTitle();

        this._fadeInWindow();
    },

    setTitle : function(label) {
        this._titleLabel.set_label(label);
    },

    refreshSize : function() {
        this._positionTexture();
    },

    toggleFullScreen : function() {
        if (!this._renderer.canFullScreen)
            return;

        if (this._isFullScreen) {
            this._exitFullScreen();
        } else {
            this._enterFullScreen();
        }
    },

    close : function() {
        this._fadeOutWindow();
    }
}
