/* global Module */

/* MMM-TautulliLatest.js 
 *
 * Magic Mirror 2
 * Module: MMM-TautulliLatest
 *
 * Magic Mirror By Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 *
 * By Erik Pettersson
 *
 */
 
Module.register("MMM-TautulliLatest", {
  defaults: {
    tautulliProtocol: "http",
    tautulliHost: "127.0.0.1",
    tautulliPort: 8181,
    tautulliBasePath: "",
    tautulliApiKey: "",
    itemLimit: 8,
    updateInterval: 5 * 60 * 1000,
    animationSpeed: 1000,
    movieLabel: "Latest Movies",
    episodeLabel: "Latest TV Episodes",
    posterWidth: 150,
    posterHeight: 225,
    posterMaxWidth: 150,
    posterMaxHeight: 225,
    detailPosterWidth: 400,
    detailPosterHeight: 600,
    showWatchedBadge: true,
    user_id: null,
    hideHeaders: false,
    requestTimeout: 15000,
    movieLibrarySectionId: null,
    showLibrarySectionId: null
  },

  // Initializes the module state and starts the first data fetch cycle.
  start: function () {
    this.dataSet = {
      movies: [],
      episodes: [],
      error: null,
      lastUpdated: null
    };
    this.loaded = false;
    this.selectedItem = null;
    this.detailPanelElement = null;
    this.boundDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.boundDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
    this.updateTimer = null;
    this.fetchLatest();
    this.scheduleNextUpdate();
  },

  // Loads the module-specific stylesheet into MagicMirror.
  getStyles: function () {
    return ["MMM-TautulliLatest.css"];
  },

  // Keeps the data refreshed on the configured interval.
  scheduleNextUpdate: function () {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    this.updateTimer = setTimeout(() => {
      this.fetchLatest();
      this.scheduleNextUpdate();
    }, this.config.updateInterval);
  },

  // Sends the active configuration to the node helper for data retrieval.
  fetchLatest: function () {
    this.sendSocketNotification("MMM_TAUTULLY_FETCH", {
      tautulliProtocol: this.config.tautulliProtocol,
      tautulliHost: this.config.tautulliHost,
      tautulliPort: this.config.tautulliPort,
      tautulliBasePath: this.config.tautulliBasePath,
      tautulliApiKey: this.config.tautulliApiKey,
      itemLimit: this.config.itemLimit,
      posterWidth: this.config.posterWidth,
      posterHeight: this.config.posterHeight,
      posterMaxWidth: this.config.posterMaxWidth,
      posterMaxHeight: this.config.posterMaxHeight,
      showWatchedBadge: this.config.showWatchedBadge,
      user_id: this.config.user_id,
      requestTimeout: this.config.requestTimeout,
      movieLibrarySectionId: this.config.movieLibrarySectionId,
      showLibrarySectionId: this.config.showLibrarySectionId
    });
  },

  // Receives normalized media data from the node helper and re-renders the module.
  socketNotificationReceived: function (notification, payload) {
    if (notification === "MMM_TAUTULLY_LATEST") {
      this.loaded = true;
      this.dataSet = payload;
      this.updateDom(this.config.animationSpeed);
    }
  },

  // Builds the top-level DOM output, including loading and error states.
  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-tautully-latest";

    if (!this.config.tautulliApiKey) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = "Configure the Tautulli API key for MMM-TautulliLatest.";
      return wrapper;
    }

    if (!this.loaded) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = "Fetching the latest additions from Plex through Tautulli...";
      return wrapper;
    }

    if (this.dataSet.error) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = this.dataSet.error;
      return wrapper;
    }

    wrapper.appendChild(this.buildSection(this.config.movieLabel, this.dataSet.movies, "movie"));
    wrapper.appendChild(this.buildSection(this.config.episodeLabel, this.dataSet.episodes, "episode"));

    if (this.selectedItem) {
      wrapper.appendChild(this.buildDetailOverlay());
    }

    return wrapper;
  },

  // Creates one section row for either movies or TV episodes.
  buildSection: function (label, items, type) {
    const section = document.createElement("section");
    section.className = "media-row";

    if (!this.config.hideHeaders) {
      const title = document.createElement("div");
      title.className = "row-title bright medium";
      title.textContent = label;
      section.appendChild(title);
    }

    const grid = document.createElement("div");
    grid.className = "media-grid";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state dimmed light small";
      empty.textContent = type === "movie"
        ? "No recently added movies were found."
        : "No recently added TV episodes were found.";
      grid.appendChild(empty);
      section.appendChild(grid);
      return section;
    }

    items.forEach((item) => {
      grid.appendChild(this.buildCard(item, type));
    });

    section.appendChild(grid);
    return section;
  },

  // Renders a single poster card with title and metadata text.
  buildCard: function (item, type) {
    const card = document.createElement("button");
    card.className = "media-card";
    card.type = "button";
    card.setAttribute("aria-label", `Open details for ${item.title}`);
    card.addEventListener("click", () => {
      this.openDetails(item, type);
    });

    const imageWrap = document.createElement("div");
    imageWrap.className = "poster-wrap";
    imageWrap.style.maxWidth = `${this.config.posterMaxWidth}px`;
    imageWrap.style.width = "100%";

    if (item.posterUrl) {
      const poster = document.createElement("img");
      poster.className = "poster";
      poster.src = item.posterUrl;
      poster.alt = item.posterAlt || item.title;
      poster.loading = "lazy";
      poster.style.width = "100%";
      poster.style.maxHeight = `${this.config.posterMaxHeight}px`;
      imageWrap.appendChild(poster);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "poster poster-placeholder";
      placeholder.textContent = "No image";
      placeholder.style.width = "100%";
      placeholder.style.maxHeight = `${this.config.posterMaxHeight}px`;
      imageWrap.appendChild(placeholder);
    }

    if (this.config.showWatchedBadge && item.watched) {
      const watchedBadge = document.createElement("div");
      watchedBadge.className = "watched-badge";
      watchedBadge.setAttribute("aria-label", "Watched");
      watchedBadge.textContent = "✓";
      imageWrap.appendChild(watchedBadge);
    }

    if (item.progressPercent > 0 && item.progressPercent < 100) {
      const progress = document.createElement("div");
      progress.className = "poster-progress";

      const progressFill = document.createElement("div");
      progressFill.className = "poster-progress-fill";
      progressFill.style.width = `${item.progressPercent}%`;

      progress.appendChild(progressFill);
      imageWrap.appendChild(progress);
    }

    card.appendChild(imageWrap);

    const title = document.createElement("div");
    title.className = "media-title bright";
    title.textContent = item.title;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "media-meta";
    meta.textContent = type === "movie" ? this.formatAddedAt(item.addedAt) : item.episodeLabel;
    card.appendChild(meta);

    return card;
  },

  // Opens the detail overlay for the selected item.
  openDetails: function (item, type) {
    this.selectedItem = {
      ...item,
      type: type
    };
    this.addDetailOverlayListeners();
    this.updateDom(this.config.animationSpeed);
  },

  // Closes the detail overlay and returns to the poster grid.
  closeDetails: function () {
    this.selectedItem = null;
    this.detailPanelElement = null;
    this.removeDetailOverlayListeners();
    this.updateDom(this.config.animationSpeed);
  },

  // Builds a touch-friendly overlay with extended details for one title.
  buildDetailOverlay: function () {
    const item = this.selectedItem;
    const overlay = document.createElement("div");
    overlay.className = "detail-overlay";

    const panel = document.createElement("div");
    panel.className = "detail-panel";
    this.detailPanelElement = panel;

    const closeButton = document.createElement("button");
    closeButton.className = "detail-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close details");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
      this.closeDetails();
    });
    panel.appendChild(closeButton);

    const media = document.createElement("div");
    media.className = "detail-media";

    if (item.posterUrl) {
      const poster = document.createElement("img");
      poster.className = "detail-poster";
      poster.src = item.detailPosterUrl || item.posterUrl;
      poster.alt = item.posterAlt || item.title;
      media.appendChild(poster);
    }

    const content = document.createElement("div");
    content.className = "detail-content";

    const title = document.createElement("div");
    title.className = "detail-title bright";
    title.textContent = item.title;
    content.appendChild(title);

    if (item.secondaryTitle) {
      const secondaryTitle = document.createElement("div");
      secondaryTitle.className = "detail-secondary";
      secondaryTitle.textContent = item.secondaryTitle;
      content.appendChild(secondaryTitle);
    }

    const facts = document.createElement("div");
    facts.className = "detail-facts";

    this.appendFact(facts, item.type === "movie" ? "Added" : "Episode", item.type === "movie"
      ? this.formatAddedAt(item.addedAt)
      : item.episodeLabel);
    this.appendFact(facts, "Year", item.year);
    this.appendFact(facts, "Released", item.originallyAvailableAt);
    this.appendFact(facts, "Genres", item.genresLabel);
    this.appendFact(facts, "Progress", this.getProgressLabel(item));

    content.appendChild(facts);

    if (item.summary) {
      const summary = document.createElement("div");
      summary.className = "detail-summary";
      summary.textContent = item.summary;
      content.appendChild(summary);
    }

    media.appendChild(content);
    panel.appendChild(media);
    overlay.appendChild(panel);

    return overlay;
  },

  // Adds global listeners while the details overlay is open.
  addDetailOverlayListeners: function () {
    document.addEventListener("pointerdown", this.boundDocumentPointerDown, true);
    document.addEventListener("keydown", this.boundDocumentKeyDown, true);
  },

  // Removes global listeners when the details overlay closes.
  removeDetailOverlayListeners: function () {
    document.removeEventListener("pointerdown", this.boundDocumentPointerDown, true);
    document.removeEventListener("keydown", this.boundDocumentKeyDown, true);
  },

  // Closes the details overlay when the pointer lands outside the panel.
  handleDocumentPointerDown: function (event) {
    if (!this.selectedItem || !this.detailPanelElement) {
      return;
    }

    if (!this.detailPanelElement.contains(event.target)) {
      this.closeDetails();
    }
  },

  // Closes the details overlay when Escape is pressed.
  handleDocumentKeyDown: function (event) {
    if (event.key === "Escape" && this.selectedItem) {
      this.closeDetails();
    }
  },

  // Adds one label/value pair to the details panel.
  appendFact: function (container, label, value) {
    if (!value) {
      return;
    }

    const fact = document.createElement("div");
    fact.className = "detail-fact";
    fact.textContent = `${label}: ${value}`;
    container.appendChild(fact);
  },

  // Formats movie added dates using MagicMirror's configured locale.
  formatAddedAt: function (unixTimestamp) {
    if (!unixTimestamp) {
      return "";
    }

    const date = new Date(Number(unixTimestamp) * 1000);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat(this.getMirrorLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  },

  // Returns a human-readable progress label for the details view.
  getProgressLabel: function (item) {
    if (item.watched) {
      return "Watched";
    }

    if (item.progressPercent > 0) {
      return `${item.progressPercent}% watched`;
    }

    return "Not started";
  },

  // Reads the global MagicMirror locale first, then falls back to language or browser locale.
  getMirrorLocale: function () {
    if (typeof config !== "undefined") {
      if (config.locale) {
        return config.locale;
      }

      if (config.language) {
        return config.language;
      }
    }

    if (typeof navigator !== "undefined" && navigator.language) {
      return navigator.language;
    }

    return "en-US";
  }
});
