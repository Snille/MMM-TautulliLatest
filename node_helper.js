/* global Module */

/* node_helper.js
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

const NodeHelper = require("node_helper");
const http = require("node:http");
const https = require("node:https");

module.exports = NodeHelper.create({
  // Handles frontend requests and returns either fresh data or an error payload.
  socketNotificationReceived: async function (notification, payload) {
    if (notification !== "MMM_TAUTULLY_FETCH") {
      return;
    }

    try {
      const data = await this.fetchLatest(payload);
      this.sendSocketNotification("MMM_TAUTULLY_LATEST", data);
    } catch (error) {
      this.sendSocketNotification("MMM_TAUTULLY_LATEST", {
        movies: [],
        episodes: [],
        lastUpdated: null,
        error: `Could not fetch data from Tautulli: ${error.message}`
      });
    }
  },

  // Fetches recent movie and episode data from Tautulli and normalizes the result set.
  fetchLatest: async function (config) {
    const moviesResponse = await this.callTautulli(config, "get_recently_added", {
      count: Math.max(config.itemLimit * 3, config.itemLimit),
      media_type: "movie",
      section_id: config.movieLibrarySectionId
    });

    const showsResponse = await this.callTautulli(config, "get_recently_added", {
      count: Math.max(config.itemLimit * 5, config.itemLimit),
      media_type: "show",
      section_id: config.showLibrarySectionId
    });

    const fallbackResponse = await this.callTautulli(config, "get_recently_added", {
      count: Math.max(config.itemLimit * 12, config.itemLimit * 2)
    });

    const fallbackItems = this.extractRecentItems(fallbackResponse);
    const movies = this.pickLatestMovies(
      this.extractRecentItems(moviesResponse),
      fallbackItems,
      config
    );
    const episodes = this.pickLatestEpisodes(
      this.extractRecentItems(showsResponse),
      fallbackItems,
      config
    );

    if (config.showWatchedBadge && config.user_id) {
      await this.enrichItemsWithWatchState(movies, config);
      await this.enrichItemsWithWatchState(episodes, config);
    }

    return {
      movies,
      episodes,
      lastUpdated: new Date().toISOString(),
      error: null
    };
  },

  // Selects and formats the newest movie items for the frontend.
  pickLatestMovies: function (primaryItems, fallbackItems, config) {
    const merged = this.mergeItems(
      primaryItems.filter((item) => item.media_type === "movie"),
      fallbackItems.filter((item) => item.media_type === "movie")
    );

    return merged
      .sort(this.sortByAddedAtDesc)
      .slice(0, config.itemLimit)
      .map((item) => this.normalizeMovie(item, config));
  },

  // Selects and formats the newest TV episode items for the frontend.
  pickLatestEpisodes: function (primaryItems, fallbackItems, config) {
    const merged = this.mergeItems(
      primaryItems.filter((item) => item.media_type === "episode"),
      fallbackItems.filter((item) => item.media_type === "episode")
    );

    return merged
      .sort(this.sortByAddedAtDesc)
      .slice(0, config.itemLimit)
      .map((item) => this.normalizeEpisode(item, config));
  },

  // Enriches normalized items with per-user watch history from Tautulli.
  enrichItemsWithWatchState: async function (items, config) {
    await Promise.all(items.map(async (item) => {
      const historyState = await this.fetchWatchState(item.ratingKey, config);
      item.watched = historyState.watched;
      item.progressPercent = historyState.progressPercent;
    }));
  },

  // Looks up the latest matching history entry for one user and one media item.
  fetchWatchState: async function (ratingKey, config) {
    if (!ratingKey || !config.user_id) {
      return { watched: false, progressPercent: 0 };
    }

    const response = await this.callTautulli(config, "get_history", {
      rating_key: ratingKey,
      user_id: config.user_id,
      length: 1,
      order_column: "date",
      order_dir: "desc"
    });

    const history = this.extractHistoryItems(response);
    if (!history.length) {
      return { watched: false, progressPercent: 0 };
    }

    const latest = history[0];
    const progressPercent = this.normalizeProgressPercent(latest.percent_complete);

    if (latest.watched_status !== undefined && latest.watched_status !== null && latest.watched_status !== "") {
      return {
        watched: String(latest.watched_status) === "1",
        progressPercent
      };
    }

    return {
      watched: progressPercent >= 90,
      progressPercent
    };
  },

  // Deduplicates media items by rating key while preserving the latest merged data.
  mergeItems: function (primaryItems, fallbackItems) {
    const itemsByKey = new Map();

    [...primaryItems, ...fallbackItems].forEach((item) => {
      if (!item || !item.rating_key) {
        return;
      }

      itemsByKey.set(String(item.rating_key), item);
    });

    return Array.from(itemsByKey.values());
  },

  // Extracts the recently added item array from a Tautulli API response.
  extractRecentItems: function (responseData) {
    const response = responseData && responseData.response ? responseData.response : {};
    const data = response.data || {};
    return Array.isArray(data.recently_added) ? data.recently_added : [];
  },

  // Extracts history rows from a Tautulli history API response.
  extractHistoryItems: function (responseData) {
    const response = responseData && responseData.response ? responseData.response : {};
    const data = response.data || {};
    return Array.isArray(data.data) ? data.data : [];
  },

  // Converts Tautulli percent values into a safe 0-100 integer.
  normalizeProgressPercent: function (percentComplete) {
    const parsed = Number(percentComplete || 0);
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(parsed)));
  },

  // Sort helper for newest-first ordering based on the added timestamp.
  sortByAddedAtDesc: function (a, b) {
    return Number(b.added_at || 0) - Number(a.added_at || 0);
  },

  // Maps a raw Tautulli movie item into the compact frontend format.
  normalizeMovie: function (item, config) {
    return {
      ratingKey: item.rating_key,
      title: item.title || item.full_title || "Unknown title",
      secondaryTitle: item.original_title && item.original_title !== item.title ? item.original_title : "",
      addedAt: item.added_at,
      summary: item.summary || "",
      year: item.year || "",
      originallyAvailableAt: item.originally_available_at || "",
      genresLabel: Array.isArray(item.genres) ? item.genres.join(", ") : "",
      watched: false,
      progressPercent: 0,
      posterUrl: this.buildPosterUrl(config, item.thumb, item.rating_key),
      detailPosterUrl: this.buildPosterUrl(
        {
          ...config,
          posterWidth: config.detailPosterWidth || 400,
          posterHeight: config.detailPosterHeight || 600
        },
        item.thumb,
        item.rating_key
      ),
      posterAlt: item.title || item.full_title || "Movie poster"
    };
  },

  // Maps a raw Tautulli episode item into the compact frontend format.
  normalizeEpisode: function (item, config) {
    const season = String(item.parent_media_index || "").padStart(2, "0");
    const episode = String(item.media_index || "").padStart(2, "0");

    return {
      ratingKey: item.rating_key,
      title: item.title || item.full_title || "Unknown episode",
      secondaryTitle: item.grandparent_title || "",
      episodeLabel: `S${season} E${episode}`,
      addedAt: item.added_at,
      summary: item.summary || "",
      year: item.year || "",
      originallyAvailableAt: item.originally_available_at || "",
      genresLabel: Array.isArray(item.genres) ? item.genres.join(", ") : "",
      watched: false,
      progressPercent: 0,
      posterUrl: this.buildPosterUrl(
        config,
        item.grandparent_thumb || item.thumb || item.parent_thumb,
        item.grandparent_rating_key || item.rating_key
      ),
      detailPosterUrl: this.buildPosterUrl(
        {
          ...config,
          posterWidth: config.detailPosterWidth || 400,
          posterHeight: config.detailPosterHeight || 600
        },
        item.grandparent_thumb || item.thumb || item.parent_thumb,
        item.grandparent_rating_key || item.rating_key
      ),
      posterAlt: item.grandparent_title
        ? `${item.grandparent_title} poster`
        : item.title || "Series poster"
    };
  },

  // Builds the image proxy URL used to serve poster artwork through Tautulli.
  buildPosterUrl: function (config, imgPath, ratingKey) {
    if (!imgPath && !ratingKey) {
      return "";
    }

    const url = new URL(this.buildApiBase(config));
    url.searchParams.set("apikey", config.tautulliApiKey);
    url.searchParams.set("cmd", "pms_image_proxy");
    url.searchParams.set("width", String(config.posterWidth));
    url.searchParams.set("height", String(config.posterHeight));
    url.searchParams.set("img_format", "png");
    url.searchParams.set("fallback", "poster");

    if (imgPath) {
      url.searchParams.set("img", imgPath);
    } else if (ratingKey) {
      url.searchParams.set("rating_key", String(ratingKey));
    }

    return url.toString();
  },

  // Builds the base URL for the Tautulli API from the module configuration.
  buildApiBase: function (config) {
    const protocol = config.tautulliProtocol || "http";
    const host = config.tautulliHost || "127.0.0.1";
    const port = config.tautulliPort || 8181;
    const cleanedBasePath = (config.tautulliBasePath || "")
      .replace(/^\/+|\/+$/g, "");
    const basePathPrefix = cleanedBasePath ? `/${cleanedBasePath}` : "";
    return `${protocol}://${host}:${port}${basePathPrefix}/api/v2`;
  },

  // Executes a Tautulli API command with query parameters and returns parsed JSON.
  callTautulli: function (config, command, params) {
    const url = new URL(this.buildApiBase(config));
    url.searchParams.set("apikey", config.tautulliApiKey);
    url.searchParams.set("cmd", command);

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    return this.requestJson(url, config.requestTimeout);
  },

  // Performs the HTTP request and validates that Tautulli returned a success response.
  requestJson: function (url, timeoutMs) {
    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const request = transport.get(url, { timeout: timeoutMs || 15000 }, (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          try {
            const parsed = JSON.parse(body);
            if (parsed && parsed.response && parsed.response.result === "success") {
              resolve(parsed);
              return;
            }

            const message = parsed && parsed.response && parsed.response.message
              ? parsed.response.message
              : "Unknown API error";
            reject(new Error(message));
          } catch (error) {
            reject(new Error("Invalid JSON response from Tautulli"));
          }
        });
      });

      request.on("error", (error) => {
        reject(error);
      });

      request.on("timeout", () => {
        request.destroy(new Error("Request to Tautulli timed out"));
      });
    });
  }
});
