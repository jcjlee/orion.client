/*******************************************************************************
 * @license
 * Copyright (c) 2010, 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *     Andy Clement (vmware) - bug 344614
 *******************************************************************************/
/*jslint browser:true*/
/*global define orion window console*/

define(['i18n!orion/widgets/nls/messages', 'orion/crawler/searchCrawler', 'orion/contentTypes', 'require', 'orion/webui/littlelib', 'orion/webui/dialog'], 
		function(messages, mSearchCrawler, mContentTypes, require, lib, dialog) {
	/**
	 * Usage: <code>new OpenResourceDialog(options).show();</code>
	 * 
	 * @name orion.webui.dialogs.OpenResourceDialog
	 * @class A dialog that searches for files by name or wildcard.
	 * @param {String} [options.title] Text to display in the dialog's titlebar.
	 * @param {orion.searchClient.Searcher} options.searcher The searcher to use for displaying results.
	 * @param {Function} options.onHide a function to call when the dialog is hidden.  Optional.
	 */
	function OpenResourceDialog(options) {
		this._init(options);
	}
	
	OpenResourceDialog.prototype = new dialog.Dialog();


	OpenResourceDialog.prototype.TEMPLATE = 
		'<div role="search">' + //$NON-NLS-0$
			'<div><label for="fileName">'+messages['Type the name of a file to open (? = any character, * = any string):']+'</label></div>' + //$NON-NLS-1$ //$NON-NLS-0$
			'<div><input id="fileName" type="text" placeholder="'+messages['Search']+'"</input></div>' + //$NON-NLS-1$ //$NON-NLS-0$
			'<div id="crawlingProgress"></div>' + //$NON-NLS-0$
			'<div id="favresults" style="max-height:400px; height:auto; overflow-y:auto;"></div>' + //$NON-NLS-0$
			'<div id="results" style="max-height:400px; height:auto; overflow-y:auto;" aria-live="off"></div>' + //$NON-NLS-0$
			'<div id="statusbar"></div>' + //$NON-NLS-0$
		'</div>'; //$NON-NLS-0$

	OpenResourceDialog.prototype._init = function(options) {
		this._searcher = options.searcher;
		this._onHide = options.onHide;
		this._contentTypeService = new mContentTypes.ContentTypeService(this._searcher.registry);
		if (!this._searcher) {
			throw new Error("Missing required argument: searcher"); //$NON-NLS-0$
		}	
		this._searchDelay = options.searchDelay || 500;
		this._time = 0;
		this._searcher.setCrawler(null);
		this._forceUseCrawler = false;
		this._searchOnRoot = true;
		this._fileService = this._searcher.getFileService();
		this._title = options.title || messages['Find File Named'];
		if (!this._fileService) {
			throw new Error(messages['Missing required argument: fileService']);
		}
		this._searchRenderer = options.searchRenderer;
		if (!this._searchRenderer || typeof(this._searchRenderer.makeRenderFunction) !== "function") { //$NON-NLS-0$
			throw new Error(messages['Missing required argument: searchRenderer']);
		}
		this._favService = options.favoriteService;
		if (!this._favService) {
			throw new Error(messages['Missing required argument: favService']);
		}
		this._initialize(options.parent);
	};
	
	OpenResourceDialog.prototype._bindToDom = function(parent) {
		var self = this;
		this.$fileName.addEventListener("input", function(evt) { //$NON-NLS-0$
			self._time = + new Date();
			if (self._timeoutId) {
				clearTimeout(self._timeoutId);
			}
			self._timeoutId = setTimeout(self.checkSearch.bind(self), 0);
		}, false);
		this.$fileName.addEventListener("keydown",function(evt) { //$NON-NLS-0$
			if (evt.keyCode === lib.KEY.ENTER) {
				var link = lib.$("a", self._results); //$NON-NLS-0$
				if (link) {
					window.open(link.href);
					self.hide();
				}
			}
		}, false);
		parent.addEventListener("keydown", function(evt) { //$NON-NLS-0$
			var favlinks, links, text, currentFocus, favCurrentSelectionIndex, currentSelectionIndex;
			var incrementFocus = function(currList, index, nextEntry) {
				if (index < currList.length - 1) {
					return currList[index+1];
				} else {
					return nextEntry;
				}
			};
			var decrementFocus = function(currList, index, prevEntry) {
				if (index > 0) {
					return currList[index-1];
				} else {
					return prevEntry;
				}
			};
			
			if (evt.keyCode === lib.KEY.DOWN || evt.keyCode === lib.KEY.UP) {
				links = lib.$$array("a", self.$results); //$NON-NLS-0$
				favlinks = lib.$$array("a", self.$favresults); //$NON-NLS-0$
				currentFocus = document.activeElement;
				currentSelectionIndex = links.indexOf(currentFocus);
				favCurrentSelectionIndex = favlinks.indexOf(currentFocus);
				if (evt.keyCode === lib.KEY.DOWN) {
					if (favCurrentSelectionIndex >= 0) {
						incrementFocus(favlinks, favCurrentSelectionIndex, links.length > 0 ? links[0] : favlinks[0]).focus();
					} else if (currentSelectionIndex >= 0) {
						incrementFocus(links, currentSelectionIndex, favlinks.length > 0 ? favlinks[0] : links[0]).focus();
					} else if (links.length > 0 || favlinks.length > 0) {
						// coming from the text box
						incrementFocus(favlinks, -1, links[0]).focus();
					}   
				} else {
					if (favCurrentSelectionIndex >= 0) {
						// jump to text box if index === 0
						text = self._fileName.value; 
						decrementFocus(favlinks, favCurrentSelectionIndex, text).focus();
					} else if (currentSelectionIndex >= 0) {
						// jump to text box if index === 0 and favlinks is empty
						text = self._fileName.value;
						decrementFocus(links, currentSelectionIndex, favlinks.length > 0 ? favlinks[favlinks.length-1] : text).focus();
					} else if (links.length > 0) {
						// coming from the text box go to end of list
						links[links.length-1].focus();
					} else if (favlinks.length > 0) {
						// coming from the text box go to end of list
						favlinks[favlinks.length-1].focus();
					}
				}
				lib.stop(evt);
			}
		});
		parent.addEventListener("mouseup", function(e) { //$NON-NLS-0$
			// WebKit focuses <body> after link is clicked; override that
			e.target.focus();
		}, false);
		this.populateFavorites();
		setTimeout(function() {
			if(self._forceUseCrawler || !self._fileService.getService(self._searcher.getSearchLocation())["search"]){//$NON-NLS-0$
				var searchLoc = self._searchOnRoot ? self._searcher.getSearchRootLocation() : self._searcher.getChildrenLocation();
				var crawler = new mSearchCrawler.SearchCrawler(self._searcher.registry, self._fileService, "", {searchOnName: true, location: searchLoc}); 
				self._searcher.setCrawler(crawler);
				crawler.buildSkeleton(function() {
					self.$crawlingProgress.classList.add("progressPane_running_dialog"); //$NON-NLS-0$
					self.$crawlingProgress.appendChild(document.createTextNode(messages['Building file skeleton...']));
					}, function(){
						self.$crawlingProgress.classList.remove("progressPane_running_dialog"); //$NON-NLS-0$
						lib.empty(self.$crawlingProgress);
					});
			}
		}, 0);
	};

	/** @private kick off initial population of favorites */
	OpenResourceDialog.prototype.populateFavorites = function() {
		var div = document.createElement("div");
		div.appendChild(document.createTextNode(messages['Populating favorites&#x2026;']));
		lib.empty(this.$favresults);
		this.$favresults.appendChild(div);
		
		// initially, show all favorites
		var self = this;
		this._favService.getFavorites().then(self.showFavorites());
		// need to add the listener since favorites may not 
		// have been initialized after first getting the favorites
		this._favService.addEventListener("favoritesChanged", self.showFavorites()); //$NON-NLS-0$
	};

	/** 
	 * @private 
	 * render the favorites that we have found, if any.
	 * this function wraps another function that does the actual work
	 * we need this so we can have access to the proper scope.
	 */
	OpenResourceDialog.prototype.showFavorites = function() {
		var that = this;
		return function(event) {
			var favs = event;
			if (favs.navigator) {
				favs = favs.navigator;
			}
			var renderFunction = that._searchRenderer.makeRenderFunction(that._contentTypeService, that.$favresults, false, 
					that.decorateResult.bind(that), that.showFavoritesImage);
			renderFunction(favs);
			if (favs && favs.length > 0) {
				that.$favresults.appendChild(document.createElement("hr")); //$NON-NLS-0$
			}
		};
	};

	/** @private */
	OpenResourceDialog.prototype.showFavoritesImage = function(col) {
		var image = new Image();
		image.classList.add("modelDecorationSprite"); //$NON-NLS-0$
		image.classList.add("core-sprite-makeFavorite"); //$NON-NLS-0$
		// without an image, chrome will draw a border  (?)
		image.src = require.toUrl("images/none.png"); //$NON-NLS-0$
		image.title = messages['Favorite'];
		col.appendChild(image);
		image.style.verticalAlign = "middle"; //$NON-NLS-0$
	};

	/** @private */
	OpenResourceDialog.prototype.checkSearch = function() {
		clearTimeout(this._timeoutId);
		var now = new Date().getTime();
		if ((now - this._time) > this._searchDelay) {
			this._time = now;
			this.doSearch();
		} else {
			this._timeoutId = setTimeout(this.checkSearch.bind(this), 50); //$NON-NLS-0$
		}
	};

	/** @private */
	OpenResourceDialog.prototype.doSearch = function() {
		var text = this.$fileName.value;

		var showFavs = this.showFavorites();
		// update favorites
		this._favService.queryFavorites(text).then(function(favs) {
			showFavs(favs);
		});

		// don't do a server-side query for an empty text box
		if (text) {
			var div = document.createElement("div");
			div.appendChild(document.createTextNode(messages['Searching...']));
			lib.empty(this.$favresults);
			this.$results.appendChild(div);
			// Gives Webkit a chance to show the "Searching" message
			var that = this;
			setTimeout(function() {
				var searchParams = that._searcher.createSearchParams(text, true, that._searchOnRoot);
				var renderFunction = that._searchRenderer.makeRenderFunction(that._contentTypeService, that.$results, false, that.decorateResult.bind(that));
				that._searcher.search(searchParams, false, renderFunction);
			}, 0);
		}
	};
	
	/** @private */
	OpenResourceDialog.prototype.decorateResult = function(resultsDiv) {
		var self = this;
		var links = lib.$$array("a", resultsDiv);
		for (var i=0; i<links.length; i++) {
			var link = links[i];
			link.addEventListener("mouseup", function(evt) { //$NON-NLS-0$
				if (evt.button === 0 && !evt.ctrlKey && !evt.metaKey) {
					self.hide();
				}
			}, false);
			link.addEventListener("keyup", function(evt) { //$NON-NLS-0$
				if (evt.keyCode === lib.KEY.ENTER) {
					self.hide();
				}
			}, false);
		};
	};
	
	/**
	 * Displays the dialog.
	 */
	OpenResourceDialog.prototype.show = function() {
		this._showDialog();
		this.$fileName.focus();
	};
	
	/** @private */
	OpenResourceDialog.prototype.hide = function() {
		clearTimeout(this._timeoutId);
		this._hideDialog();
		if (this._onHide) {
			this._onHide();
		}
	};
	
	OpenResourceDialog.prototype.constructor = OpenResourceDialog;
	//return the module exports
	return {OpenResourceDialog: OpenResourceDialog};
});
