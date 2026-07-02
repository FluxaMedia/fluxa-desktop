import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import { MovieCard } from '../MovieCard';
import { t } from '../../i18n';
import type { DetailState, LibraryItem, Meta, MetaLink, Stream, Trailer, Video } from '../../core/types';
import type { posterPrefsFromState } from '../../core/posterPrefs';
import { MS, S, spinnerStyle } from './detailStyles';
import { CastAvatar, type NormalizedCastMember } from './castSection';
import { TrailerCarousel, type TrailerMetadata } from './TrailerCarousel';
import { InlineSourceList, MovieSourcePanel } from './SourcePanel';
import { SeasonDropdown, seasonLabel, formatEpDate as _formatEpDate, type ProgressEntry } from './EpisodePanel';
import { ModernPlayButton, ModernTabBar } from './DetailButtons';
import { ModernEpisodeCard } from './ModernEpisodeCard';
import { useSeasonWatched } from '../../hooks/useSeasonWatched';

export type ModernDetailProps = {
  displayMeta: Meta;
  bgUrl: string | null | undefined;
  isSeries: boolean;
  detail: DetailState;
  meta: Meta;
  episodes: Video[];
  filteredEps: Video[];
  seasonNumbers: number[];
  selectedSeason: number;
  selectedEpisode: Video | null;
  showSources: boolean;
  streams: Stream[];
  episodePlan: { seasonNumbers?: number[]; selectedSeason?: number; episodes?: Video[]; selectedEpisode?: Video | null } | null;
  similarItems: Meta[];
  displayTrailers: Trailer[];
  trailerMetadata: TrailerMetadata;
  castMembers: NormalizedCastMember[];
  directorLinks: MetaLink[];
  peopleImages: Record<string, string>;
  watchedMap: Record<string, boolean>;
  progressMap: Record<string, ProgressEntry>;
  continueWatchingEntry?: LibraryItem | null;
  trailerOnHero: boolean;
  blurUnwatchedEpisodes: boolean;
  detailSeasonSelectorMode: string;
  episodeCardsLayout: string;
  isInWatchlist: boolean;
  availableAddons: string[];
  poster: ReturnType<typeof posterPrefsFromState>;
  onBack: () => void;
  onDispatch: (actionJson: string) => void;
  onNavigateDetail: (meta: Meta) => void;
  onNavigateGenre?: (genre: string) => void;
  onSeasonChange: (season: number) => void;
  onEpisodeClick: (ep: Video) => void;
  onMovieSources: () => void;
  onBackToEpisodes: () => void;
  onPlaySource: (stream: Stream) => void;
  onPlay: (stream: Stream, meta: Meta, episode?: Video | null, resumeAt?: number) => void;
  onBgError: () => void;
};

export function ModernDetailLayout({
  displayMeta, bgUrl, isSeries, detail, meta, episodes, filteredEps, seasonNumbers,
  selectedSeason, selectedEpisode, showSources, streams, episodePlan, similarItems,
  displayTrailers, trailerMetadata, castMembers, directorLinks, peopleImages,
  watchedMap, progressMap, continueWatchingEntry, isInWatchlist: _isInWatchlist, availableAddons, poster,
  trailerOnHero: _trailerOnHero, blurUnwatchedEpisodes: _blurUnwatchedEpisodes,
  detailSeasonSelectorMode: _detailSeasonSelectorMode, episodeCardsLayout: _episodeCardsLayout,
  onBack, onDispatch, onNavigateDetail, onNavigateGenre, onSeasonChange, onEpisodeClick,
  onMovieSources, onBackToEpisodes, onPlaySource, onPlay, onBgError,
}: ModernDetailProps) {
  const [activeTab, setActiveTab] = useState<'episodes' | 'related' | 'details'>('episodes');
  const [prevSeasonDialog, setPrevSeasonDialog] = useState<{ season: number; unwatchedPrev: number[] } | null>(null);

  const { seasonWatchedMap, dispatchMarkSeason, toggleEpisodeWatched } = useSeasonWatched({
    meta, displayMeta, episodes, seasonNumbers, watchedMap, onDispatch,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (prevSeasonDialog) { setPrevSeasonDialog(null); return; }
      if (showSources) { onBackToEpisodes(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevSeasonDialog, showSources, onBackToEpisodes]);

  const toggleSeasonWatched = useCallback(() => {
    const isWatched = seasonWatchedMap[selectedSeason] === true;
    if (isWatched) { dispatchMarkSeason([selectedSeason], false); return; }
    const unwatchedPrev = seasonNumbers.filter((s) => s > 0 && s < selectedSeason && !seasonWatchedMap[s]);
    if (unwatchedPrev.length > 0) {
      setPrevSeasonDialog({ season: selectedSeason, unwatchedPrev });
    } else {
      dispatchMarkSeason([selectedSeason], true);
    }
  }, [selectedSeason, seasonWatchedMap, seasonNumbers, dispatchMarkSeason]);

  const continueEp = episodePlan?.selectedEpisode ?? filteredEps[0] ?? episodes[0];
  const hasProgress = episodePlan?.selectedEpisode != null;
  const continueLabel = continueEp
    ? t('format.season_episode_short', continueEp.season ?? 1, continueEp.episode ?? continueEp.number ?? 1)
    : null;

  const modernMetaDetails: string[] = [];
  if (displayMeta.imdbRating) modernMetaDetails.push(`IMDb ${displayMeta.imdbRating}/10`);
  if (displayMeta.releaseInfo) modernMetaDetails.push(displayMeta.releaseInfo);
  if (isSeries && seasonNumbers.length > 0) modernMetaDetails.push(`${seasonNumbers.length} ${t('auto.seasons')}`);
  const metaGenres = displayMeta.genres?.slice(0, 3) ?? [];

  return (
    <div style={MS.screen}>
      {/* Hero */}
      <div style={MS.heroWrap}>
        {bgUrl ? (
          <>
            <img src={bgUrl} alt="" style={MS.heroImg} onError={onBgError} />
            <div style={MS.heroGradLeft} />
            <div style={MS.heroGradBottom} />
          </>
        ) : (
          <div style={MS.heroPlaceholder} />
        )}
        <button style={MS.backBtn} onClick={onBack}>
          <ArrowLeft size={18} color="rgba(255,255,255,0.85)" />
        </button>
        <div style={MS.logoWrap}>
          {displayMeta.logo ? (
            <img src={displayMeta.logo} alt={displayMeta.name} style={MS.logo} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <h1 style={MS.titleHero}>{displayMeta.name}</h1>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={MS.content}>
        <>
          <div style={MS.actionRow}>
            <ModernPlayButton
              continueLabel={isSeries ? continueLabel : null}
              hasProgress={isSeries ? hasProgress : false}
              onClick={() => {
                if (isSeries) { if (continueEp) onEpisodeClick(continueEp); }
                else onMovieSources();
              }}
            />
          </div>

          <div style={MS.metaBlock}>
            {(metaGenres.length > 0 || modernMetaDetails.length > 0) && (
              <p style={MS.metaInfoLine}>
                {metaGenres.map((g, i) => (
                  <React.Fragment key={g}>
                    <span style={MS.genreTag} onClick={() => onNavigateGenre?.(g)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigateGenre?.(g); }}>{g}</span>
                    {(i < metaGenres.length - 1 || modernMetaDetails.length > 0) && <span style={MS.metaDot}> • </span>}
                  </React.Fragment>
                ))}
                {modernMetaDetails.length > 0 && <span>{modernMetaDetails.join(' • ')}</span>}
              </p>
            )}
            {displayMeta.description && <p style={MS.descText}>{displayMeta.description}</p>}
            {castMembers.length > 0 && (
              <p style={MS.castLine}>
                <span style={{ color: 'rgba(255,255,255,0.28)' }}>{t('detail.cast_crew')}: </span>
                {castMembers.slice(0, 5).map((m, i) => (
                  <React.Fragment key={m.name}>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{m.name}</span>
                    {i < Math.min(castMembers.length, 5) - 1 && <span style={{ color: 'rgba(255,255,255,0.2)' }}>, </span>}
                  </React.Fragment>
                ))}
              </p>
            )}
          </div>

          {isSeries && (
            <>
              <div style={MS.seasonRowModern}>
                <SeasonDropdown seasons={seasonNumbers} selected={selectedSeason} onChange={onSeasonChange} buttonStyle={MS.seasonBtn} seasonWatched={seasonWatchedMap} hideButtonIndicator />
                <button
                  onClick={toggleSeasonWatched}
                  title={seasonWatchedMap[selectedSeason] ? t('detail.mark_season_unwatched') : t('detail.mark_season_watched')}
                  style={MS.seasonWatchedBtn}
                >
                  {seasonWatchedMap[selectedSeason] ? (
                    <CheckCircle2 size={18} color="rgba(255,255,255,0.75)" />
                  ) : (
                    <Circle size={18} color="rgba(255,255,255,0.28)" />
                  )}
                  <span style={MS.seasonWatchedLabel}>
                    {t(seasonWatchedMap[selectedSeason] ? 'detail.mark_season_unwatched' : 'detail.mark_season_watched')}
                  </span>
                </button>
              </div>

              {prevSeasonDialog && (
                <div style={MS.overlayBackdrop} onClick={() => setPrevSeasonDialog(null)}>
                  <div style={{ ...MS.overlaySheet, maxWidth: 400, padding: 28 }} onClick={(e) => e.stopPropagation()}>
                    <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>
                      {t('detail.prev_seasons_dialog_title')}
                    </p>
                    <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 24px', lineHeight: '20px' }}>
                      {t('detail.prev_seasons_dialog_body', prevSeasonDialog.unwatchedPrev.map((s) => seasonLabel(s)).join(', '))}
                    </p>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => { dispatchMarkSeason([prevSeasonDialog.season], true); setPrevSeasonDialog(null); }}>
                        {t('detail.prev_seasons_dialog_no')}
                      </button>
                      <button style={{ background: 'var(--primary-accent-color)', border: 'none', color: 'var(--primary-accent-foreground-color, #fff)', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => { dispatchMarkSeason([...prevSeasonDialog.unwatchedPrev, prevSeasonDialog.season], true); setPrevSeasonDialog(null); }}>
                        {t('detail.prev_seasons_dialog_yes')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <ModernTabBar
                tabs={[
                  { id: 'episodes', label: t('auto.episodes') },
                  { id: 'related', label: t('auto.similar_titles') },
                  { id: 'details', label: t('common.details') },
                ]}
                active={activeTab}
                onChange={(id) => setActiveTab(id as typeof activeTab)}
              />

              {activeTab === 'episodes' && (
                <div style={{ ...MS.episodeSection, minHeight: 200 }}>
                  {detail.isLoading && filteredEps.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div style={spinnerStyle} /></div>
                  ) : (
                    <>
                      <p style={MS.episodeCount}>{t('format.episode_count', filteredEps.length)}</p>
                      <div style={MS.episodeGrid}>
                        {filteredEps.map((ep, i) => {
                          const isWatched = watchedMap[ep.id] === true;
                          const metaProgress = progressMap[meta.id];
                          const showProg = !isWatched && metaProgress?.lastVideoId === ep.id && (metaProgress.duration ?? 0) > 0;
                          const progressPct = isWatched ? 100 : (showProg ? Math.min(99, Math.round((metaProgress!.timeOffset / metaProgress!.duration) * 100)) : 0);
                          const minutesRemaining = showProg ? Math.max(0, Math.round((metaProgress!.duration - metaProgress!.timeOffset) / 60)) : 0;
                          const isCwEp = continueWatchingEntry?.lastVideoId === ep.id;
                          const cwBadge = isCwEp ? (continueWatchingEntry?.continueWatchingBadge ?? null) : null;
                          const cwScheduledDate = cwBadge === 'scheduledEpisode' ? (continueWatchingEntry as LibraryItem & { newEpisodeReleasedAt?: string })?.newEpisodeReleasedAt : undefined;
                          return (
                            <ModernEpisodeCard
                              key={ep.id}
                              episode={ep}
                              number={i + 1}
                              isWatched={isWatched}
                              progressPct={progressPct}
                              minutesRemaining={minutesRemaining}
                              cwBadge={cwBadge}
                              cwScheduledDate={cwScheduledDate}
                              onClick={() => onEpisodeClick(ep)}
                              onToggleWatched={() => toggleEpisodeWatched(ep, isWatched)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'related' && (
                <div style={{ ...MS.relatedSection, minHeight: 200 }}>
                  {similarItems.length === 0 ? (
                    <p style={MS.episodeCount}>{t('auto.no_similar_titles')}</p>
                  ) : (
                    <div style={MS.relatedGrid}>
                      {similarItems.slice(0, 24).map((item) => (
                        <MovieCard key={`${item.type}:${item.id}`} meta={item} width={poster.width} height={poster.height} radius={poster.radius} hideTitle={poster.hideTitles} layout={poster.layout} onClick={onNavigateDetail} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'details' && (
                <div style={{ ...MS.detailsTab, minHeight: 200 }}>
                  {displayMeta.description && (
                    <div style={MS.detailsSection}>
                      <h3 style={MS.detailsSectionTitle}>{t('detail.summary')}</h3>
                      <p style={MS.detailsText}>{displayMeta.description}</p>
                    </div>
                  )}
                  {(castMembers.length > 0 || directorLinks.length > 0) && (
                    <div style={MS.detailsSection}>
                      <h3 style={MS.detailsSectionTitle}>{t('detail.cast_crew')}</h3>
                      <div style={S.castRow}>
                        {directorLinks.map((l) => <CastAvatar key={`dir-${l.name}`} name={l.name} role={t('detail.director')} imageUrl={peopleImages[l.name]} />)}
                        {castMembers.map((member) => <CastAvatar key={`cast-${member.name}:${member.role ?? ''}`} name={member.name} role={member.role || t('detail.actor')} imageUrl={member.imageUrl ?? peopleImages[member.name]} />)}
                      </div>
                    </div>
                  )}
                  {displayTrailers.length > 0 && (
                    <div style={MS.detailsSection}>
                      <h3 style={MS.detailsSectionTitle}>{t('auto.trailers')}</h3>
                      <TrailerCarousel trailers={displayTrailers} trailerMetadata={trailerMetadata} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!isSeries && displayTrailers.length > 0 && (
            <div style={S.trailerSection}>
              <h2 style={S.similarTitle}>{t('auto.trailers')}</h2>
              <TrailerCarousel trailers={displayTrailers} trailerMetadata={trailerMetadata} />
            </div>
          )}
          {!isSeries && similarItems.length > 0 && (
            <div style={S.similarSection}>
              <h2 style={S.similarTitle}>{t('auto.similar_titles')}</h2>
              <div style={MS.relatedGrid}>
                {similarItems.slice(0, 16).map((item) => (
                  <MovieCard key={`${item.type}:${item.id}`} meta={item} width={poster.width} height={poster.height} radius={poster.radius} hideTitle={poster.hideTitles} layout={poster.layout} onClick={onNavigateDetail} />
                ))}
              </div>
            </div>
          )}
        </>
      </div>

      {showSources && selectedEpisode && isSeries && (
        <div style={MS.overlayBackdrop} onClick={onBackToEpisodes}>
          <div style={MS.overlaySheet} onClick={(e) => e.stopPropagation()}>
            <InlineSourceList episode={selectedEpisode} meta={displayMeta} streams={streams} isLoading={!!detail.isLoadingStreams} availableAddons={availableAddons} onBack={onBackToEpisodes} onPlay={onPlaySource} />
          </div>
        </div>
      )}

      {showSources && !isSeries && (
        <div style={MS.overlayBackdrop} onClick={onBackToEpisodes}>
          <div style={MS.overlaySheet} onClick={(e) => e.stopPropagation()}>
            <MovieSourcePanel meta={displayMeta} streams={streams} isLoading={!!detail.isLoadingStreams} availableAddons={availableAddons} onPlay={(stream) => onPlay(stream, displayMeta, null)} onClose={onBackToEpisodes} />
          </div>
        </div>
      )}
    </div>
  );
}
